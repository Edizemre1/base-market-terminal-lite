import { BASE_CHAIN_ID, BASE_USDC, BASE_WETH, COLLECTOR_VERSION, FACTORY_REGISTRY } from "./factory-registry.mjs";
import { appendRelayEvent, applyCanonicalEvents, buildCanonicalOpportunities, coalesceBoundedQueue, decodeFactoryLog, reconcileCanonicalWindow } from "./model.mjs";
import { enrichTokenMetadata, inspectRegisteredPool, JsonRpcClient, readSupportedPoolState, readTokenDecimals, verifyPoolBinding } from "./rpc.mjs";
import { DurableDiscoveryStore, pricingPoolsForState } from "./store.mjs";
import {
  ENRICHMENT_MAX_ATTEMPTS,
  ProviderEnrichmentClient,
  PROVIDER_REFRESH_MS,
  UNMATCHED_REFRESH_MS,
  coalesceEnrichmentQueue,
  joinExactProviderPools,
  nextRetryAt,
  resolveWethUsdcAnchor,
  selectAnchorValidationCandidates,
  stabilizeWethUsdcAnchorRefresh
} from "./provider-enrichment.mjs";

const ENABLED = FACTORY_REGISTRY.filter((entry) => entry.enabled);

export function resolveCollectorConfig(environment = process.env) {
  const httpUrl = environment.BASE_RPC_HTTP_URL?.trim() || "https://mainnet.base.org";
  const websocketUrl = environment.BASE_RPC_WS_URL?.trim();
  return {
    httpUrl,
    websocketUrl: websocketUrl && /^wss?:\/\//i.test(websocketUrl) ? websocketUrl : undefined,
    storeDirectory: environment.ONCHAIN_STORE_PATH?.trim() || ".data/onchain-discovery",
    pollIntervalMs: boundedInteger(environment.ONCHAIN_POLL_INTERVAL_MS, 3_000, 1_000, 60_000),
    bootstrapBlocks: boundedInteger(environment.ONCHAIN_BOOTSTRAP_BLOCKS, 2_000, 64, 10_000),
    maximumChunksPerPass: boundedInteger(environment.ONCHAIN_MAX_CHUNKS_PER_PASS, 4, 1, 16),
    metadataBatchSize: boundedInteger(environment.ONCHAIN_METADATA_BATCH_SIZE, 12, 1, 32),
    enrichmentBatchSize: boundedInteger(environment.ONCHAIN_ENRICHMENT_BATCH_SIZE, 4, 1, 8),
    enrichmentIntervalMs: boundedInteger(environment.ONCHAIN_ENRICHMENT_INTERVAL_MS, 2_000, 500, 30_000),
    providerTimeoutMs: boundedInteger(environment.ONCHAIN_PROVIDER_TIMEOUT_MS, 8_000, 1_000, 20_000)
  };
}

export class OnchainDiscoveryCollector {
  constructor(config = resolveCollectorConfig()) {
    this.config = config;
    this.rpc = new JsonRpcClient(config.httpUrl);
    this.provider = config.providerClient ?? new ProviderEnrichmentClient({ timeoutMs: config.providerTimeoutMs });
    // Anchor availability is a pricing safety boundary. Keep its provider
    // request and bounded RPC validation independent from the normal exact-pool
    // backlog so queued enrichment cannot age out a healthy anchor.
    this.anchorProvider = config.anchorProviderClient ?? new ProviderEnrichmentClient({
      timeoutMs: config.providerTimeoutMs,
      retries: 0
    });
    this.anchorRpc = config.anchorRpcClient ?? new JsonRpcClient(config.httpUrl, {
      timeoutMs: Math.min(5_000, config.providerTimeoutMs),
      retries: 0
    });
    this.store = new DurableDiscoveryStore(config.storeDirectory);
    this.running = false;
    this.websocket = undefined;
    this.websocketReconnectTimer = undefined;
    this.websocketRequestId = 1;
  }

  async open() {
    await this.store.open();
    const state = await this.store.transact("initialize-enrichment-state", (draft) => {
      ensureEnrichmentState(draft);
      seedEnrichmentQueue(draft, new Date());
    });
    if (this.config.websocketUrl) this.startWebsocket();
    return state;
  }

  async run(signal) {
    this.running = true;
    const enrichment = this.runEnrichmentLoop(signal);
    const anchor = this.runAnchorLoop(signal);
    while (this.running && !signal?.aborted) {
      const startedAt = Date.now();
      try { await this.scanOnce(); }
      catch (error) { await this.recordFailure(error); }
      const remaining = Math.max(50, this.config.pollIntervalMs - (Date.now() - startedAt));
      await delay(remaining, signal);
    }
    await Promise.all([enrichment, anchor]);
  }

  async scanOnce() {
    const head = await this.rpc.blockNumber();
    const confirmations = Math.max(...ENABLED.map((entry) => entry.confirmationPolicy.confirmations));
    const confirmedHead = Math.max(0, head - confirmations);
    let state = this.store.read();
    const cursors = ENABLED.map((entry) => state.cursors?.[entry.id]?.blockNumber ?? 0);
    if (cursors.some((cursor) => cursor <= 0)) {
      const initialCursor = Math.max(1, confirmedHead - this.config.bootstrapBlocks - 1);
      state = await this.store.transact("initialize-bounded-cursors", (draft) => {
        for (const entry of ENABLED) draft.cursors[entry.id] = { blockNumber: initialCursor, blockHash: undefined, updatedAt: new Date().toISOString() };
        draft.currentHead = head;
        draft.confirmedHead = confirmedHead;
        draft.health.backfillState = "catching_up";
      });
    }

    let cursor = Math.min(...ENABLED.map((entry) => state.cursors[entry.id].blockNumber));
    let chunks = 0;
    while (cursor < confirmedHead && chunks < this.config.maximumChunksPerPass) {
      const maximumChunk = Math.min(...ENABLED.map((entry) => entry.confirmationPolicy.maximumChunkBlocks));
      const overlap = Math.max(...ENABLED.map((entry) => entry.confirmationPolicy.overlapBlocks));
      const fromBlock = Math.max(1, cursor - overlap + 1);
      const toBlock = Math.min(confirmedHead, cursor + maximumChunk);
      const rawLogs = await this.rpc.getLogs({
        fromBlock,
        toBlock,
        addresses: ENABLED.map((entry) => entry.address),
        topics: [...new Set(ENABLED.map((entry) => entry.eventTopic))]
      });
      const decoded = rawLogs.map((log) => decodeFactoryLog(log)).filter(Boolean);
      const malformedCount = rawLogs.length - decoded.length;
      const confirmed = [];
      for (const event of decoded) {
        const binding = await verifyPoolBinding(this.rpc, event, event.blockNumber);
        if (!binding.ok) continue;
        const block = await this.rpc.getBlock(event.blockNumber);
        const timestampSeconds = block?.timestamp ? Number.parseInt(block.timestamp, 16) : undefined;
        confirmed.push({
          ...event,
          provisional: false,
          verifiedBinding: binding.kind,
          blockTimestamp: Number.isFinite(timestampSeconds) ? new Date(timestampSeconds * 1_000).toISOString() : undefined
        });
      }
      state = await this.store.transact("confirmed-log-reconciliation", (draft) => {
        const next = reconcileCanonicalWindow(draft, confirmed, fromBlock, toBlock);
        for (const token of confirmed.flatMap((event) => [event.token0, event.token1])) {
          if (!next.tokenMetadata[token]) next.metadataQueue = coalesceBoundedQueue(next.metadataQueue, [{ poolKey: token, tokenAddress: token, blockNumber: toBlock }], 256);
        }
        ensureEnrichmentState(next);
        const enrichmentJobs = confirmed.flatMap((event) => event.poolAddress ? [{
          poolKey: event.poolKey,
          poolAddress: event.poolAddress,
          priority: 100,
          attempts: 0,
          createdAt: new Date().toISOString(),
          nextAttemptAt: new Date().toISOString()
        }] : []);
        next.enrichmentQueue = coalesceEnrichmentQueue(next.enrichmentQueue, enrichmentJobs);
        for (const entry of ENABLED) next.cursors[entry.id] = { blockNumber: toBlock, blockHash: undefined, updatedAt: new Date().toISOString() };
        next.currentHead = head;
        next.confirmedHead = confirmedHead;
        next.counters.malformedRejected += malformedCount;
        next.health = buildHealth(next, head, confirmedHead, this.config.websocketUrl ? (this.websocket?.readyState === WebSocket.OPEN ? "websocket" : "reconnecting") : "confirmed_polling");
        return next;
      });
      cursor = toBlock;
      chunks += 1;
    }
    await this.drainMetadata();
    return this.store.read();
  }

  async replayConfirmedEvent({ blockNumber, transactionHash, logIndex }) {
    const rawLogs = await this.rpc.getLogs({
      fromBlock: blockNumber,
      toBlock: blockNumber,
      addresses: ENABLED.map((entry) => entry.address),
      topics: [...new Set(ENABLED.map((entry) => entry.eventTopic))]
    });
    const selected = rawLogs
      .map((log) => decodeFactoryLog({ ...log, replay: true }))
      .filter(Boolean)
      .filter((event) => !transactionHash || event.transactionHash === transactionHash.toLowerCase())
      .filter((event) => logIndex === undefined || event.logIndex === logIndex);
    if (!selected.length) throw new Error("No verified registry event matched the replay provenance");
    const event = selected[0];
    const binding = await verifyPoolBinding(this.rpc, event, event.blockNumber);
    if (!binding.ok) throw new Error(`Replay pool binding rejected: ${binding.reason}`);
    const metadata = {};
    for (const token of [event.token0, event.token1]) metadata[token] = await enrichTokenMetadata(this.rpc, token, event.blockNumber);
    const sandbox = applyCanonicalEvents(this.store.read(), [{ ...event, provisional: false, replay: true }], { replay: true });
    const opportunities = buildCanonicalOpportunities(pricingPoolsForState(sandbox), { ...sandbox.tokenMetadata, ...metadata }, sandbox.opportunities);
    const evidence = {
      replay: true,
      replayedAt: new Date().toISOString(),
      exactProvenance: { blockNumber: event.blockNumber, blockHash: event.blockHash, transactionHash: event.transactionHash, logIndex: event.logIndex },
      event,
      pool: sandbox.pools[event.poolKey],
      opportunities: opportunities.filter((opportunity) => opportunity.poolKeys.includes(event.poolKey)),
      cursorBefore: Object.fromEntries(Object.entries(this.store.read().cursors).map(([id, cursor]) => [id, cursor.blockNumber]))
    };
    await this.store.transact("deterministic-historical-replay-evidence", (draft) => {
      draft.replayEvidence ??= [];
      draft.replayEvidence.push(evidence);
      draft.replayEvidence = draft.replayEvidence.slice(-16);
    });
    return evidence;
  }

  async close() {
    this.running = false;
    if (this.websocketReconnectTimer) clearTimeout(this.websocketReconnectTimer);
    this.websocketReconnectTimer = undefined;
    try { this.websocket?.close(); } catch { /* best effort */ }
    this.websocket = undefined;
    await this.store.close();
  }

  async drainMetadata() {
    const state = this.store.read();
    const batch = (state.metadataQueue ?? []).slice(0, this.config.metadataBatchSize);
    if (!batch.length) return;
    const results = {};
    for (const item of batch) {
      results[item.tokenAddress] = await enrichTokenMetadata(this.rpc, item.tokenAddress, item.blockNumber);
    }
    await this.store.transact("bounded-token-metadata-enrichment", (draft) => {
      draft.tokenMetadata = { ...draft.tokenMetadata, ...results };
      const completed = new Set(batch.map((item) => item.tokenAddress));
      draft.metadataQueue = draft.metadataQueue.filter((item) => !completed.has(item.tokenAddress));
      draft.health.metadataQueueDepth = draft.metadataQueue.length;
    });
  }

  async runEnrichmentLoop(signal) {
    while (this.running && !signal?.aborted) {
      const startedAt = Date.now();
      try { await this.runEnrichmentCycle(); }
      catch (error) {
        await this.store.transact("enrichment-cycle-failure", (draft) => {
          ensureEnrichmentState(draft);
          draft.counters.enrichmentFailure += 1;
          draft.health.lastEnrichmentFailure = safeError(error);
          refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
        }).catch(() => {});
      }
      await delay(Math.max(50, this.config.enrichmentIntervalMs - (Date.now() - startedAt)), signal);
    }
  }

  async runEnrichmentCycle(now = new Date()) {
    const initial = this.store.read();
    if (hasEnrichmentSeedCandidate(initial, now)) {
      await this.store.transact("seed-bounded-enrichment-queue", (draft) => {
        ensureEnrichmentState(draft);
        seedEnrichmentQueue(draft, now);
        refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
      });
    }
    const state = this.store.read();
    const due = (state.enrichmentQueue ?? [])
      .filter((item) => !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now.getTime())
      .slice(0, this.config.enrichmentBatchSize);
    if (!due.length) return this.store.read();
    const before = this.store.read();
    const outcomes = await Promise.all(due.map(async (item) => {
      const pool = before.pools[item.poolKey];
      if (!pool?.poolAddress || pool.status !== "confirmed" || pool.orphaned) return { item, status: "discarded", reasonCode: "pool_no_longer_eligible" };
      try {
        const lookup = await this.provider.lookupPool(pool.poolAddress);
        const metadata = { ...before.tokenMetadata };
        const metadataUpdates = {};
        for (const token of [pool.token0, pool.token1]) {
          if (Number.isInteger(metadata[token]?.decimals)) continue;
          const exactDecimals = await readTokenDecimals(this.rpc, token, "latest");
          if (!exactDecimals.ok) continue;
          metadataUpdates[token] = { ...metadata[token], address: token, decimals: exactDecimals.decimals, codeExists: true, observedAt: exactDecimals.observedAt, blockNumber: before.currentHead, status: metadata[token]?.name && metadata[token]?.symbol ? "complete" : "partial" };
          metadata[token] = metadataUpdates[token];
        }
        const decimalsVerified = [pool.token0, pool.token1].every((token) => Number.isInteger(metadata[token]?.decimals));
        const onchainState = await readSupportedPoolState(this.rpc, pool, metadata, "latest");
        const joined = joinExactProviderPools(pool, lookup.observations, { onchainState, now });
        if (joined.status === "matched" && !decimalsVerified) {
          joined.priceToken1PerToken0 = undefined;
          joined.rawPriceRatio = undefined;
          joined.reasonCode = "invalid_decimals";
        }
        joined.decimalsVerified = decimalsVerified;
        return { item, status: joined.status, joined, lookup, metadataUpdates, circuits: lookup.circuits };
      } catch (error) {
        return { item, status: "failed", reasonCode: error?.reasonCode ?? "enrichment_failure", retryable: Boolean(error?.retryable) };
      }
    }));
    const after = await this.store.transact("bounded-pool-financial-enrichment", (draft) => {
      ensureEnrichmentState(draft);
      const completed = new Set();
      for (const outcome of outcomes) {
        const key = outcome.item.poolKey;
        const pool = draft.pools[key];
        if (!pool) { completed.add(key); continue; }
        if (outcome.metadataUpdates) draft.tokenMetadata = { ...draft.tokenMetadata, ...outcome.metadataUpdates };
        if (outcome.status === "matched") {
          const joined = outcome.joined;
          draft.pools[key] = {
            ...pool,
            observedAt: joined.observedAt,
            marketObservedAt: joined.observedAt,
            providers: [...new Set([...(pool.providers ?? []), ...joined.providers])].sort(),
            priceToken1PerToken0: joined.priceToken1PerToken0,
            rawPriceRatio: joined.rawPriceRatio,
            priceUsd: joined.priceUsd,
            observedPricesUsd: joined.observedPricesUsd,
            liquidityUsd: joined.liquidityUsd,
            volumes: joined.volumes,
            volume24hUsd: joined.volume24hUsd,
            transactions: joined.transactions,
            trades24h: joined.trades24h,
            providerSnapshots: joined.providerSnapshots,
            fieldProvenance: joined.fieldProvenance,
            onchainState: joined.onchainState,
            providerIndexedAt: pool.providerIndexedAt ?? joined.receivedAt ?? joined.observedAt,
            providerIndexingLatencyMs: pool.providerIndexingLatencyMs ?? indexingLatencyMs(pool.firstSeenAt, joined.receivedAt ?? joined.observedAt),
            providerEnrichment: {
              status: "matched",
              reasonCode: joined.reasonCode,
              selectedProvider: joined.selectedProvider,
              providers: joined.providers,
              orientation: joined.orientation,
              decimalsVerified: joined.decimalsVerified,
              observedAt: joined.observedAt,
              exactLookupState: "found",
              cacheHit: Boolean(outcome.lookup?.cacheHit),
              poolInfoStatus: outcome.lookup?.poolInfo ? "found" : "unavailable",
              nextRefreshAt: new Date(now.getTime() + PROVIDER_REFRESH_MS).toISOString()
            }
          };
          draft.counters.enrichmentSuccess += 1;
          draft.counters.providerMatched += 1;
          draft.counters.exactLookupSuccess += 1;
          draft.health.lastSuccessfulEnrichment = joined.observedAt;
          completed.add(key);
          continue;
        }
        if (outcome.status === "failed" && outcome.retryable && (outcome.item.attempts ?? 0) + 1 < ENRICHMENT_MAX_ATTEMPTS) {
          const attempts = (outcome.item.attempts ?? 0) + 1;
          const queued = draft.enrichmentQueue.find((item) => item.poolKey === key);
          if (queued) Object.assign(queued, { attempts, nextAttemptAt: nextRetryAt(attempts, now), lastReason: outcome.reasonCode });
          draft.counters.enrichmentFailure += 1;
          continue;
        }
        const reasonCode = outcome.joined?.reasonCode ?? outcome.reasonCode ?? "provider_pool_not_found";
        const recentlyDetected = reasonCode === "provider_pool_not_found" && isRecentlyDetected(pool, now);
        const providerStatus = outcome.status === "conflicting" ? "conflicting" : outcome.status === "discarded" ? "discarded" : recentlyDetected ? "pending" : "unmatched";
        draft.pools[key] = {
          ...pool,
          providerEnrichment: {
            status: providerStatus,
            reasonCode,
            observedAt: now.toISOString(),
            exactLookupState: recentlyDetected ? "pending_indexing" : "not_found",
            negativeResultExpiresAt: new Date(now.getTime() + 2 * 60_000).toISOString(),
            nextRefreshAt: new Date(now.getTime() + (recentlyDetected ? 30_000 : UNMATCHED_REFRESH_MS)).toISOString()
          }
        };
        if (outcome.status === "conflicting") draft.counters.priceConflict += 1;
        else draft.counters.providerUnmatched += 1;
        if (recentlyDetected) draft.counters.exactLookupPending += 1;
        else if (reasonCode === "provider_pool_not_found") draft.counters.exactLookupNotFound += 1;
        if (outcome.status === "failed") draft.counters.enrichmentFailure += 1;
        completed.add(key);
      }
      draft.enrichmentQueue = draft.enrichmentQueue.filter((item) => !completed.has(item.poolKey));
      refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
    });
    await this.publishSemanticDeltas(before, after, outcomes.map((outcome) => outcome.item.poolKey));
    return this.store.read();
  }

  async runAnchorLoop(signal) {
    while (this.running && !signal?.aborted) {
      const startedAt = Date.now();
      try {
        await this.refreshAnchorIfDue(new Date());
      } catch (error) {
        await this.store.transact("trusted-anchor-loop-failure", (draft) => {
          ensureEnrichmentState(draft);
          const failedAt = new Date();
          draft.health.lastAnchorLoopFailure = safeError(error);
          draft.priceAnchors.wethUsdc.nextRefreshAt = new Date(failedAt.getTime() + 10_000).toISOString();
          draft.counters.enrichmentFailure += 1;
          refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
        }).catch(() => {});
      }
      if (!this.running || signal?.aborted) break;
      await delay(Math.max(250, 5_000 - (Date.now() - startedAt)), signal);
    }
  }

  async refreshAnchorIfDue(now = new Date()) {
    const before = this.store.read();
    const current = before.priceAnchors?.wethUsdc;
    if (current?.nextRefreshAt && Date.parse(current.nextRefreshAt) > now.getTime()) return before;
    try {
      const observations = selectAnchorValidationCandidates(await this.anchorProvider.lookupWethPools());
      const lookupCompletedAt = new Date();
      const blockNumber = before.currentHead || await this.anchorRpc.blockNumber();
      const metadata = { ...before.tokenMetadata };
      for (const token of [BASE_WETH, BASE_USDC]) {
        if (!Number.isInteger(metadata[token]?.decimals)) {
          const exactDecimals = await readTokenDecimals(this.anchorRpc, token, "latest");
          metadata[token] = exactDecimals.ok
            ? { ...metadata[token], address: token, decimals: exactDecimals.decimals, codeExists: true, observedAt: exactDecimals.observedAt, blockNumber, status: metadata[token]?.name && metadata[token]?.symbol ? "complete" : "partial" }
            : metadata[token] ?? await enrichTokenMetadata(this.anchorRpc, token, blockNumber, now);
        }
      }
      const inspected = await mapWithConcurrency(observations, 2, async (observation) => {
        let pool = trustedAnchorPoolIdentity(current, observation.poolAddress);
        if (!pool) {
          const identity = await inspectRegisteredPool(this.anchorRpc, observation.poolAddress, "latest");
          if (!identity.ok || !sameTokenSet(identity.token0, identity.token1, BASE_WETH, BASE_USDC)) return undefined;
          pool = {
            poolKey: observation.poolAddress,
            poolAddress: observation.poolAddress,
            token0: identity.token0,
            token1: identity.token1,
            factoryId: identity.registry.id,
            factoryAddress: identity.registry.address,
            protocolVersion: identity.registry.protocolVersion
          };
        }
        const onchainState = await readSupportedPoolState(this.anchorRpc, pool, metadata, "latest");
        const joined = joinExactProviderPools(pool, [observation], { onchainState, now: lookupCompletedAt });
        if (joined.status !== "matched") return undefined;
        const canonicalRate = pool.token0 === BASE_WETH ? joined.priceToken1PerToken0 : joined.priceToken1PerToken0 > 0 ? 1 / joined.priceToken1PerToken0 : undefined;
        return {
          ...joined,
          token0: pool.token0,
          token1: pool.token1,
          registeredFactory: true,
          decimalsVerified: Number.isInteger(metadata[BASE_WETH]?.decimals) && Number.isInteger(metadata[BASE_USDC]?.decimals),
          factoryId: pool.factoryId,
          factoryAddress: pool.factoryAddress,
          protocolVersion: pool.protocolVersion,
          blockNumber,
          priceToken1PerToken0: canonicalRate,
          rawPriceRatio: pool.token0 === BASE_WETH ? joined.rawPriceRatio : invertRawRatio(joined.rawPriceRatio)
        };
      });
      const completedAt = new Date();
      const candidateAnchor = resolveWethUsdcAnchor(inspected.filter(Boolean), completedAt);
      const anchor = stabilizeWethUsdcAnchorRefresh(current, candidateAnchor, completedAt);
      const after = await this.store.transact("trusted-weth-usdc-anchor-refresh", (draft) => {
        ensureEnrichmentState(draft);
        draft.tokenMetadata = { ...draft.tokenMetadata, ...metadata };
        draft.priceAnchors.wethUsdc = anchor;
        if (anchor.status === "ready") draft.health.lastSuccessfulEnrichment = anchor.observedAt;
        draft.counters.staleAnchorRejected += anchor.rejected.filter((item) => item.reasonCode === "stale_anchor").length;
        draft.counters.dustRejected += anchor.rejected.filter((item) => item.reasonCode === "dust_anchor_liquidity").length;
        refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
      });
      await this.publishSemanticDeltas(before, after, []);
      return after;
    } catch (error) {
      return this.store.transact("trusted-anchor-refresh-failure", (draft) => {
        ensureEnrichmentState(draft);
        const failedAt = new Date();
        const anchor = draft.priceAnchors.wethUsdc;
        const observed = Date.parse(anchor?.observedAt ?? "");
        if (!Number.isFinite(observed) || failedAt.getTime() - observed > 2 * 60_000) {
          draft.priceAnchors.wethUsdc = { ...anchor, status: "unavailable", reasonCode: error?.reasonCode ?? "anchor_provider_failure", freshness: "unavailable" };
        }
        draft.priceAnchors.wethUsdc.nextRefreshAt = new Date(failedAt.getTime() + 10_000).toISOString();
        draft.counters.enrichmentFailure += 1;
        refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
      });
    }
  }

  async publishSemanticDeltas(before, after, touchedPoolKeys) {
    const events = [];
    for (const poolKey of touchedPoolKeys) {
      const previous = before.pools?.[poolKey]?.providerEnrichment?.status;
      const current = after.pools?.[poolKey]?.providerEnrichment?.status;
      if (previous !== "matched" && current === "matched") {
        events.push({ type: "pool_enriched", data: { poolKey, providers: after.pools[poolKey].providerEnrichment.providers } });
        events.push({ type: "provider_pool_found", data: { poolKey, providerIndexedAt: after.pools[poolKey].providerIndexedAt } });
      }
      if (previous !== "pending" && current === "pending") events.push({ type: "provider_pool_pending", data: { poolKey, reasonCode: after.pools[poolKey].providerEnrichment.reasonCode } });
    }
    const beforeAnchor = semanticAnchor(before.priceAnchors?.wethUsdc);
    const afterAnchor = semanticAnchor(after.priceAnchors?.wethUsdc);
    if (beforeAnchor !== afterAnchor) events.push({ type: "anchor_updated", data: { anchor: BASE_WETH, quote: BASE_USDC, status: after.priceAnchors?.wethUsdc?.status, value: after.priceAnchors?.wethUsdc?.value, sourcePoolCount: after.priceAnchors?.wethUsdc?.sourcePoolCount } });
    const previousById = new Map((before.opportunities ?? []).map((item) => [item.id, item]));
    for (const opportunity of after.opportunities ?? []) {
      const previous = previousById.get(opportunity.id);
      if (previous?.canonicalPrice?.tier === "UNPRICED" && opportunity.canonicalPrice.tier !== "UNPRICED") events.push({ type: "opportunity_priced", data: { opportunityId: opportunity.id, tier: opportunity.canonicalPrice.tier, value: opportunity.canonicalPrice.value } });
      if (previous?.canonicalPrice?.tier !== "UNPRICED" && opportunity.canonicalPrice.tier === "UNPRICED") events.push({ type: "opportunity_unpriced", data: { opportunityId: opportunity.id, reasonCode: opportunity.canonicalPrice.reasonCode } });
      if (!previous?.ranked && opportunity.ranked) events.push({ type: "opportunity_activated", data: { opportunityId: opportunity.id, tier: opportunity.canonicalPrice.tier } });
      if (!previous?.observedPriceUsd && opportunity.observedPriceUsd) events.push({ type: "opportunity_observed_price", data: { opportunityId: opportunity.id, value: opportunity.observedPriceUsd.value, provider: opportunity.observedPriceUsd.provider, poolAddress: opportunity.observedPriceUsd.poolAddress } });
      if (previous && previous.qualityBand !== opportunity.qualityBand) events.push({ type: "opportunity_band_changed", data: { opportunityId: opportunity.id, previousBand: previous.qualityBand, band: opportunity.qualityBand } });
      if (!previous?.ranked && opportunity.ranked) events.push({ type: "opportunity_ranked", data: { opportunityId: opportunity.id, band: opportunity.qualityBand } });
      if (previous?.ranked && !opportunity.ranked) events.push({ type: "opportunity_unranked", data: { opportunityId: opportunity.id, reasonCode: opportunity.exclusionReason } });
      if (previous && semanticMetrics(previous) !== semanticMetrics(opportunity)) events.push({ type: "metrics_updated", data: { opportunityId: opportunity.id, aggregate: opportunity.aggregate } });
    }
    if (!events.length) return after;
    return this.store.transact("semantic-enrichment-deltas", (draft) => {
      const at = new Date().toISOString();
      for (const event of events) appendRelayEvent(draft, event.type, event.data, at);
      draft.counters.bandTransitions += events.filter((event) => event.type === "opportunity_band_changed").length;
    });
  }

  startWebsocket() {
    if (!this.running && this.store.closed) return;
    try {
      const socket = new WebSocket(this.config.websocketUrl);
      this.websocket = socket;
      socket.addEventListener("open", () => {
        const id = this.websocketRequestId++;
        socket.send(JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "eth_subscribe",
          params: ["logs", { address: ENABLED.map((entry) => entry.address), topics: [[...new Set(ENABLED.map((entry) => entry.eventTopic))]] }]
        }));
        void this.store.transact("websocket-connected", (draft) => {
          draft.mode = "websocket";
          draft.health.mode = "websocket";
        }).catch(() => {});
      });
      socket.addEventListener("message", (message) => {
        void this.handleWebsocketMessage(message.data).catch(() => {});
      });
      socket.addEventListener("close", () => this.scheduleWebsocketReconnect());
      socket.addEventListener("error", () => { try { socket.close(); } catch { /* best effort */ } });
    } catch { this.scheduleWebsocketReconnect(); }
  }

  async handleWebsocketMessage(data) {
    const payload = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    const raw = payload?.method === "eth_subscription" ? payload.params?.result : undefined;
    if (!raw) return;
    const event = decodeFactoryLog({ ...raw, provisional: true });
    if (!event) {
      await this.store.transact("malformed-provisional-event", (draft) => { draft.counters.malformedRejected += 1; });
      return;
    }
    await this.store.transact("provisional-websocket-event", (draft) => {
      const next = applyCanonicalEvents(draft, [{ ...event, provisional: true }]);
      next.provisional[event.idempotencyKey] = { ...event, receivedAt: new Date().toISOString() };
      next.provisional = Object.fromEntries(Object.entries(next.provisional).slice(-256));
      next.health.lastEventTime = new Date().toISOString();
      return next;
    });
  }

  scheduleWebsocketReconnect() {
    this.websocket = undefined;
    if (!this.running && this.store.closed) return;
    if (this.websocketReconnectTimer || !this.config.websocketUrl) return;
    void this.store.transact("websocket-reconnecting", (draft) => {
      draft.mode = "reconnecting";
      draft.counters.reconnectCount += 1;
      draft.health.mode = "reconnecting";
      draft.health.reconnectCount = draft.counters.reconnectCount;
    }).catch(() => {});
    this.websocketReconnectTimer = setTimeout(() => {
      this.websocketReconnectTimer = undefined;
      this.startWebsocket();
    }, 2_000);
  }

  async recordFailure(error) {
    await this.store.transact("collector-scan-failure", (draft) => {
      draft.health.ready = false;
      draft.health.backfillState = "retrying";
      draft.health.lastFailure = safeError(error);
      if (this.config.websocketUrl && this.websocket?.readyState !== WebSocket.OPEN) draft.health.mode = "reconnecting";
    });
  }
}

export function trustedAnchorPoolIdentity(anchor, poolAddress) {
  const candidates = [...(anchor?.candidates ?? []), ...(anchor?.lastTrustedCandidates ?? [])];
  const candidate = candidates.find((item) => item?.poolAddress === poolAddress
    && item.registeredFactory === true
    && item.decimalsVerified === true
    && sameTokenSet(item.token0, item.token1, BASE_WETH, BASE_USDC));
  if (!candidate) return undefined;
  const registry = ENABLED.find((item) => item.id === candidate.factoryId && item.address === candidate.factoryAddress);
  if (!registry) return undefined;
  return {
    poolKey: poolAddress,
    poolAddress,
    token0: candidate.token0,
    token1: candidate.token1,
    factoryId: registry.id,
    factoryAddress: registry.address,
    protocolVersion: registry.protocolVersion
  };
}

function buildHealth(state, head, confirmedHead, mode) {
  ensureEnrichmentState(state);
  refreshEnrichmentHealth(state, state.health.providerCircuits ?? {});
  const cursor = Math.min(...ENABLED.map((entry) => state.cursors[entry.id].blockNumber));
  const lagBlocks = Math.max(0, confirmedHead - cursor);
  const latestEvent = Object.values(state.events ?? {}).filter((event) => event.status === "confirmed" && !event.replay).sort((left, right) => right.blockNumber - left.blockNumber)[0];
  return {
    ...state.health,
    ready: cursor > 0 && lagBlocks <= 16,
    mode,
    currentHead: head,
    confirmedCursor: cursor,
    lagBlocks,
    lagSeconds: lagBlocks * 2,
    lastEventTime: latestEvent?.firstSeenAt ?? state.health.lastEventTime,
    lastConfirmedEvent: latestEvent ? { blockNumber: latestEvent.blockNumber, transactionHash: latestEvent.transactionHash, logIndex: latestEvent.logIndex } : undefined,
    factories: Object.fromEntries(ENABLED.map((entry) => [entry.id, { enabled: true, healthy: state.cursors[entry.id].blockNumber > 0, cursor: state.cursors[entry.id].blockNumber }])),
    reconnectCount: state.counters.reconnectCount,
    backfillState: lagBlocks === 0 ? "caught_up" : "catching_up",
    reorgCount: state.counters.reorgCount,
    duplicateDropped: state.counters.duplicateDropped,
    malformedRejected: state.counters.malformedRejected,
    metadataQueueDepth: state.metadataQueue.length,
    enrichmentQueueDepth: state.enrichmentQueue.length,
    storeIntegrity: "ok",
    collectorVersion: COLLECTOR_VERSION,
    chainId: BASE_CHAIN_ID
  };
}

function ensureEnrichmentState(state) {
  state.enrichmentQueue ??= [];
  state.priceAnchors ??= {};
  state.priceAnchors.wethUsdc ??= { status: "unavailable", reasonCode: "not_initialized", sourcePoolCount: 0, freshness: "unavailable" };
  state.counters ??= {};
  for (const key of ["reconnectCount", "reorgCount", "duplicateDropped", "malformedRejected", "enrichmentSuccess", "enrichmentFailure", "providerMatched", "providerUnmatched", "priceConflict", "staleAnchorRejected", "dustRejected", "exactLookupSuccess", "exactLookupPending", "exactLookupNotFound", "bandTransitions"]) {
    if (!Number.isFinite(state.counters[key])) state.counters[key] = 0;
  }
  state.health ??= {};
}

function seedEnrichmentQueue(state, now) {
  const reprioritized = (state.enrichmentQueue ?? []).flatMap((item) => {
    const pool = state.pools?.[item.poolKey];
    if (!pool) return [];
    const containsAnchor = sameTokenSet(pool.token0, pool.token1, BASE_WETH, BASE_USDC);
    return [{ ...item, priority: enrichmentPriority(state, pool, containsAnchor, now) }];
  });
  const jobs = Object.values(state.pools ?? {}).flatMap((pool) => {
    if (pool.status !== "confirmed" || pool.orphaned || !/^0x[0-9a-f]{40}$/.test(pool.poolAddress ?? "")) return [];
    const refreshAt = Date.parse(pool.providerEnrichment?.nextRefreshAt ?? "");
    if (Number.isFinite(refreshAt) && refreshAt > now.getTime()) return [];
    const containsAnchor = sameTokenSet(pool.token0, pool.token1, BASE_WETH, BASE_USDC);
    return [{
      poolKey: pool.poolKey,
      poolAddress: pool.poolAddress,
      priority: enrichmentPriority(state, pool, containsAnchor, now),
      attempts: 0,
      createdAt: now.toISOString(),
      nextAttemptAt: now.toISOString()
    }];
  });
  state.enrichmentQueue = coalesceEnrichmentQueue(reprioritized, jobs);
  state.health.enrichmentQueueDepth = state.enrichmentQueue.length;
}

function hasEnrichmentSeedCandidate(state, now) {
  const queued = new Set((state.enrichmentQueue ?? []).map((item) => item.poolKey));
  return Object.values(state.pools ?? {}).some((pool) => {
    if (queued.has(pool.poolKey) || pool.status !== "confirmed" || pool.orphaned || !/^0x[0-9a-f]{40}$/.test(pool.poolAddress ?? "")) return false;
    const refreshAt = Date.parse(pool.providerEnrichment?.nextRefreshAt ?? "");
    return !Number.isFinite(refreshAt) || refreshAt <= now.getTime();
  });
}

function refreshEnrichmentHealth(state, circuits) {
  const pools = Object.values(state.pools ?? {}).filter((pool) => pool.status === "confirmed" && !pool.orphaned && !pool.replay);
  const matched = pools.filter((pool) => pool.providerEnrichment?.status === "matched");
  const unmatched = pools.filter((pool) => ["unmatched", "conflicting", "discarded"].includes(pool.providerEnrichment?.status));
  const pending = pools.filter((pool) => pool.providerEnrichment?.status === "pending");
  const reasons = {};
  for (const pool of unmatched) {
    const reason = pool.providerEnrichment?.reasonCode ?? "unknown";
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const tiers = { A: 0, B: 0, C: 0, UNPRICED: 0 };
  for (const opportunity of state.opportunities ?? []) tiers[opportunity.canonicalPrice?.tier ?? "UNPRICED"] += 1;
  const anchor = state.priceAnchors?.wethUsdc ?? {};
  const bands = { RANKED: 0, EMERGING: 0, DETECTED: 0, REJECTED: 0 };
  const liquidityStates = { liquidity_unknown: 0, thin_liquidity: 0, zero_liquidity: 0, usable_liquidity: 0 };
  const categoryEligibilityCounts = { new: 0, detected: 0, gainersLosers: 0, volume: 0, liquidity: 0, mostTraded: 0 };
  for (const opportunity of state.opportunities ?? []) {
    if (bands[opportunity.qualityBand] !== undefined) bands[opportunity.qualityBand] += 1;
    if (liquidityStates[opportunity.liquidityState] !== undefined) liquidityStates[opportunity.liquidityState] += 1;
    for (const key of Object.keys(categoryEligibilityCounts)) if (opportunity.categoryEligibility?.[key]) categoryEligibilityCounts[key] += 1;
  }
  const indexingLatencies = matched.map((pool) => pool.providerIndexingLatencyMs).filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  const pendingTimes = [
    ...(state.enrichmentQueue ?? []).map((item) => item.createdAt),
    ...pending.map((pool) => pool.firstSeenAt)
  ].filter(Boolean).sort();
  state.health = {
    ...state.health,
    enrichmentQueueDepth: state.enrichmentQueue?.length ?? 0,
    enrichmentSuccess: state.counters.enrichmentSuccess,
    enrichmentFailure: state.counters.enrichmentFailure,
    providerMatchedPools: matched.length,
    providerUnmatchedPools: unmatched.length,
    providerPendingPools: pending.length,
    providerUnmatchedReasons: reasons,
    anchorStatus: anchor.status ?? "unavailable",
    anchorUsdPrice: anchor.value,
    anchorSourcePoolCount: anchor.sourcePoolCount ?? 0,
    anchorSelectedPools: anchor.consensusPools ?? [],
    anchorObservedAt: anchor.observedAt,
    anchorFreshness: anchor.freshness ?? "unavailable",
    anchorDeviation: anchor.deviation,
    anchorReasonCode: anchor.reasonCode,
    pricingTierCounts: tiers,
    pricedOpportunities: tiers.A + tiers.B + tiers.C,
    rankedOpportunities: (state.opportunities ?? []).filter((item) => item.ranked).length,
    rankedCount: bands.RANKED,
    emergingCount: bands.EMERGING,
    detectedCount: bands.DETECTED,
    rejectedConflictingCount: bands.REJECTED + pools.filter((pool) => pool.providerEnrichment?.status === "conflicting").length,
    observedPriceCount: (state.opportunities ?? []).filter((item) => Number.isFinite(item.observedPriceUsd?.value) && item.observedPriceUsd.value > 0).length,
    canonicalPriceCount: tiers.A + tiers.B + tiers.C,
    liquidityUnknownCount: liquidityStates.liquidity_unknown,
    thinLiquidityCount: liquidityStates.thin_liquidity,
    zeroLiquidityCount: liquidityStates.zero_liquidity,
    usableLiquidityCount: liquidityStates.usable_liquidity,
    exactLookupQueueDepth: state.enrichmentQueue?.length ?? 0,
    exactLookupSuccess: matched.length,
    exactLookupPending: pending.length,
    exactLookupNotFound: pools.filter((pool) => pool.providerEnrichment?.exactLookupState === "not_found").length,
    providerIndexingLatencyMs: summarizeLatency(indexingLatencies),
    bandTransitions: state.counters.bandTransitions,
    categoryEligibilityCounts,
    oldestPendingEnrichment: pendingTimes[0],
    providerCircuits: circuits,
    priceConflictCount: state.counters.priceConflict,
    staleAnchorRejectionCount: state.counters.staleAnchorRejected,
    dustRejectionCount: state.counters.dustRejected
  };
}

function semanticAnchor(anchor) {
  return JSON.stringify({ status: anchor?.status, value: Number.isFinite(anchor?.value) ? Number(anchor.value.toPrecision(10)) : undefined, pools: anchor?.consensusPools, reasonCode: anchor?.reasonCode });
}

function semanticMetrics(opportunity) {
  return JSON.stringify({ aggregate: opportunity?.aggregate, lifecycle: opportunity?.lifecycle, ranked: opportunity?.ranked, qualityBand: opportunity?.qualityBand, observedPriceUsd: opportunity?.observedPriceUsd, liquidityState: opportunity?.liquidityState });
}

function enrichmentPriority(state, pool, containsAnchor, now) {
  if (isRecentlyDetected(pool, now)) return 100;
  if (containsAnchor) return 95;
  const opportunity = (state.opportunities ?? []).find((item) => item.poolKeys?.includes(pool.poolKey));
  if (opportunity?.categoryEligibility?.new) return 90;
  if (pool.providerEnrichment?.status === "matched") return 85;
  if (opportunity?.qualityBand === "RANKED") return 80;
  if (opportunity?.qualityBand === "EMERGING") return 60;
  if (pool.providerEnrichment?.status === "pending") return 55;
  return 30;
}

function isRecentlyDetected(pool, now, maximumAgeMs = 15 * 60_000) {
  const detected = Date.parse(pool?.firstSeenAt ?? pool?.confirmedAt ?? "");
  return Number.isFinite(detected) && now.getTime() >= detected && now.getTime() - detected <= maximumAgeMs;
}

function indexingLatencyMs(firstSeenAt, providerIndexedAt) {
  const first = Date.parse(firstSeenAt ?? "");
  const indexed = Date.parse(providerIndexedAt ?? "");
  return Number.isFinite(first) && Number.isFinite(indexed) && indexed >= first ? indexed - first : undefined;
}

function summarizeLatency(values) {
  if (!values.length) return { count: 0 };
  return { count: values.length, min: values[0], median: percentile(values, 0.5), p95: percentile(values, 0.95), max: values.at(-1) };
}

function percentile(values, ratio) {
  const index = (values.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  return lower === upper ? values[lower] : values[lower] + (values[upper] - values[lower]) * (index - lower);
}

function sameTokenSet(left0, left1, right0, right1) {
  return left0 === right0 && left1 === right1 || left0 === right1 && left1 === right0;
}

function invertRawRatio(value) {
  return value?.numerator && value?.denominator ? { numerator: value.denominator, denominator: value.numerator } : undefined;
}

async function mapWithConcurrency(items, concurrency, operation) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      try { results[index] = await operation(items[index]); }
      catch { results[index] = undefined; }
    }
  });
  await Promise.all(workers);
  return results;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function safeError(error) {
  const message = error instanceof Error ? error.message : "unknown collector failure";
  return message.replace(/https?:\/\/\S+/gi, "[redacted-rpc]").slice(0, 240);
}

function delay(milliseconds, signal) {
  return new Promise((resolve) => {
    let timer;
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    timer = setTimeout(finish, milliseconds);
    signal?.addEventListener("abort", finish, { once: true });
  });
}
