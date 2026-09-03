import { BASE_CHAIN_ID, BASE_USDC, BASE_WETH, COLLECTOR_VERSION, FACTORY_REGISTRY } from "./factory-registry.mjs";
import { appendRelayEvent, applyCanonicalEvents, buildCanonicalOpportunities, coalesceBoundedQueue, decodeFactoryLog, reconcileCanonicalWindow } from "./model.mjs";
import { enrichTokenMetadata, inspectRegisteredPool, JsonRpcClient, readSupportedPoolState, readTokenDecimals, verifyPoolBinding, verifyPoolBindings } from "./rpc.mjs";
import { DurableDiscoveryStore, pricingPoolsForState } from "./store.mjs";
import { ONCHAIN_STATE_REFRESH_MS, acceptOnchainStateUpdate, readPoolOnchainState, resolveOnchainAdapter, unsupportedOnchainState, validTokenDecimals } from "./onchain-state.mjs";
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
const PUBLIC_RPC_BLOCK_BATCH_CALL_LIMIT = 8;
const DERIVED_CYCLE_BACKFILL_DELAY_MS = 1_000;
const MINIMUM_DISCOVERY_IDLE_MS = 3_000;
const NORMAL_POLL_INTERVAL_MS = 10_000;
const NORMAL_DERIVED_INTERVAL_MS = 30_000;

export function derivedCyclesReady(state) {
  return state?.health?.backfillState === "caught_up";
}

export function nextScanDelayMs(pollIntervalMs, elapsedMs) {
  return Math.max(MINIMUM_DISCOVERY_IDLE_MS, pollIntervalMs - Math.max(0, elapsedMs));
}

function storeDerivedCyclesReady(store) {
  return store?.state ? derivedCyclesReady(store.state) : true;
}

export function resolveCollectorConfig(environment = process.env) {
  const httpUrl = environment.BASE_RPC_HTTP_URL?.trim() || "https://mainnet.base.org";
  const websocketUrl = environment.BASE_RPC_WS_URL?.trim();
  return {
    httpUrl,
    websocketUrl: websocketUrl && /^wss?:\/\//i.test(websocketUrl) ? websocketUrl : undefined,
    storeDirectory: environment.ONCHAIN_STORE_PATH?.trim() || ".data/onchain-discovery",
    pollIntervalMs: boundedInteger(environment.ONCHAIN_POLL_INTERVAL_MS, NORMAL_POLL_INTERVAL_MS, 1_000, 60_000),
    bootstrapBlocks: boundedInteger(environment.ONCHAIN_BOOTSTRAP_BLOCKS, 2_000, 64, 10_000),
    maximumChunksPerPass: boundedInteger(environment.ONCHAIN_MAX_CHUNKS_PER_PASS, 4, 1, 16),
    metadataBatchSize: boundedInteger(environment.ONCHAIN_METADATA_BATCH_SIZE, 1, 1, 32),
    onchainStateBatchSize: boundedInteger(environment.ONCHAIN_STATE_BATCH_SIZE, 1, 1, 12),
    onchainLocalClassificationBatchSize: boundedInteger(environment.ONCHAIN_LOCAL_CLASSIFICATION_BATCH_SIZE, 128, 1, 512),
    onchainStateIntervalMs: boundedInteger(environment.ONCHAIN_STATE_INTERVAL_MS, NORMAL_DERIVED_INTERVAL_MS, 500, 120_000),
    onchainStateCycleTimeoutMs: boundedInteger(environment.ONCHAIN_STATE_CYCLE_TIMEOUT_MS, 45_000, 10_000, 90_000),
    enrichmentBatchSize: boundedInteger(environment.ONCHAIN_ENRICHMENT_BATCH_SIZE, 4, 1, 8),
    enrichmentIntervalMs: boundedInteger(environment.ONCHAIN_ENRICHMENT_INTERVAL_MS, NORMAL_DERIVED_INTERVAL_MS, 500, 120_000),
    providerTimeoutMs: boundedInteger(environment.ONCHAIN_PROVIDER_TIMEOUT_MS, 8_000, 1_000, 20_000),
    discoveryBatchPaceMs: boundedInteger(environment.ONCHAIN_DISCOVERY_BATCH_PACE_MS, 3_000, 250, 5_000),
    anchorCycleTimeoutMs: boundedInteger(environment.ONCHAIN_ANCHOR_CYCLE_TIMEOUT_MS, 45_000, 10_000, 90_000),
    anchorLoopIntervalMs: 5_000
  };
}

export class OnchainDiscoveryCollector {
  constructor(config = resolveCollectorConfig()) {
    this.config = config;
    this.rpc = new JsonRpcClient(config.httpUrl);
    this.discoveryRpc = config.discoveryRpcClient ?? new JsonRpcClient(config.httpUrl, {
      timeoutMs: Math.min(8_000, config.providerTimeoutMs ?? 8_000),
      retries: 3,
      circuitFailureThreshold: 2,
      circuitCooldownMs: 5_000,
      batchPaceMs: config.discoveryBatchPaceMs ?? 3_000
    });
    this.stateRpc = config.stateRpcClient ?? new JsonRpcClient(config.httpUrl, { timeoutMs: Math.min(8_000, config.providerTimeoutMs ?? 8_000), retries: 2 });
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
    this.lastObservedHead = undefined;
    this.lastObservedConfirmedHead = undefined;
    this.managerCodeEvidence = new Map();
  }

  async open() {
    await this.store.open();
    const state = await this.store.transact("initialize-enrichment-state", (draft) => {
      ensureEnrichmentState(draft);
      seedEnrichmentQueue(draft, new Date());
      seedMetadataQueue(draft, new Date());
      seedOnchainQueue(draft, new Date());
    });
    if (this.config.websocketUrl) this.startWebsocket();
    return state;
  }

  async run(signal) {
    this.running = true;
    const enrichment = this.runEnrichmentLoop(signal);
    const anchor = this.runAnchorLoop(signal);
    const onchainState = this.runOnchainStateLoop(signal);
    while (this.running && !signal?.aborted) {
      const scanStartedAt = Date.now();
      try { await this.scanOnce(); }
      catch (error) { await this.recordFailure(error); }
      await delay(nextScanDelayMs(this.config.pollIntervalMs, Date.now() - scanStartedAt), signal);
    }
    await Promise.all([enrichment, anchor, onchainState]);
  }

  async scanOnce() {
    const head = await this.rpc.blockNumber();
    const confirmations = Math.max(...ENABLED.map((entry) => entry.confirmationPolicy.confirmations));
    const confirmedHead = Math.max(0, head - confirmations);
    this.lastObservedHead = head;
    this.lastObservedConfirmedHead = confirmedHead;
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
    const windows = [];
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
      const confirmed = await verifyFactoryEvents(this.discoveryRpc, decoded, 4, { managerCodeEvidence: this.managerCodeEvidence });
      windows.push({ confirmed, fromBlock, toBlock, malformedCount });
      cursor = toBlock;
      chunks += 1;
    }
    if (windows.length) {
      state = await this.store.transact("confirmed-log-reconciliation", (draft) => {
        let next = draft;
        for (const window of windows) next = reconcileCanonicalWindow(next, window.confirmed, window.fromBlock, window.toBlock);
        const confirmed = windows.flatMap((window) => window.confirmed);
        const committedAt = new Date();
        for (const token of confirmed.flatMap((event) => [event.token0, event.token1])) {
          if (!next.tokenMetadata[token]) next.metadataQueue = coalesceBoundedQueue(next.metadataQueue, [{ poolKey: token, tokenAddress: token, blockNumber: cursor }], 256);
        }
        ensureEnrichmentState(next);
        const enrichmentJobs = confirmed.flatMap((event) => event.poolAddress ? [{
          poolKey: event.poolKey,
          poolAddress: event.poolAddress,
          priority: 100,
          attempts: 0,
          createdAt: committedAt.toISOString(),
          nextAttemptAt: committedAt.toISOString()
        }] : []);
        next.enrichmentQueue = coalesceEnrichmentQueue(next.enrichmentQueue, enrichmentJobs);
        seedMetadataQueue(next, committedAt);
        seedOnchainQueue(next, committedAt);
        for (const entry of ENABLED) next.cursors[entry.id] = { blockNumber: cursor, blockHash: undefined, updatedAt: committedAt.toISOString() };
        next.currentHead = head;
        next.confirmedHead = confirmedHead;
        next.counters.malformedRejected += windows.reduce((total, window) => total + window.malformedCount, 0);
        next.health = buildHealth(next, head, confirmedHead, this.config.websocketUrl ? (this.websocket?.readyState === WebSocket.OPEN ? "websocket" : "reconnecting") : "confirmed_polling");
        next.health.lastFailure = undefined;
        return next;
      });
    }
    if (derivedCyclesReady(state)) await this.drainMetadata();
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
    const now = new Date();
    const batch = (state.metadataQueue ?? []).filter((item) => !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now.getTime()).slice(0, this.config.metadataBatchSize);
    if (!batch.length) return;
    const results = Object.fromEntries(await Promise.all(batch.map(async (item) => [item.tokenAddress, await enrichTokenMetadata(this.rpc, item.tokenAddress, item.blockNumber, now)])));
    await this.store.transact("bounded-token-metadata-enrichment", (draft) => {
      const completed = new Set();
      for (const item of batch) {
        const previous = draft.tokenMetadata[item.tokenAddress];
        const result = results[item.tokenAddress];
        if (previous?.verificationState === "verified") { completed.add(item.tokenAddress); continue; }
        draft.tokenMetadata[item.tokenAddress] = result;
        if (result.verificationState === "verified") {
          completed.add(item.tokenAddress);
          draft.counters.tokenMetadataVerified += 1;
          appendRelayEvent(draft, "token_metadata_verified", { tokenAddress: item.tokenAddress, decimals: result.decimals, blockNumber: result.blockNumber }, result.observedAt);
        } else if (!result.retryable || (item.attempts ?? 0) >= 5) {
          completed.add(item.tokenAddress);
        } else {
          const queued = draft.metadataQueue.find((row) => row.tokenAddress === item.tokenAddress);
          const attempts = (item.attempts ?? 0) + 1;
          if (queued) Object.assign(queued, { attempts, nextAttemptAt: new Date(now.getTime() + Math.min(15 * 60_000, 15_000 * 2 ** attempts)).toISOString(), lastReason: result.failureReason });
        }
      }
      draft.metadataQueue = draft.metadataQueue.filter((item) => !completed.has(item.tokenAddress));
      seedMetadataQueue(draft, now);
      draft.health.metadataQueueDepth = draft.metadataQueue.length;
    });
  }

  async runOnchainStateLoop(signal) {
    while (this.running && !signal?.aborted) {
      if (!storeDerivedCyclesReady(this.store)) {
        await delay(DERIVED_CYCLE_BACKFILL_DELAY_MS, signal);
        continue;
      }
      const cycleController = new AbortController();
      const cycleSignal = signal ? AbortSignal.any([signal, cycleController.signal]) : cycleController.signal;
      let deadline;
      try {
        const timeout = new Promise((_, reject) => {
          deadline = setTimeout(() => {
            const error = new Error("onchain_state_cycle_deadline_exceeded");
            error.reasonCode = "onchain_state_cycle_deadline_exceeded";
            cycleController.abort(error);
            reject(error);
          }, this.config.onchainStateCycleTimeoutMs ?? 45_000);
        });
        await Promise.race([this.runOnchainStateCycle(new Date(), cycleSignal), timeout]);
      }
      catch (error) {
        await this.store.transact("onchain-state-cycle-failure", (draft) => {
          ensureEnrichmentState(draft);
          draft.counters.onchainStateFailure += 1;
          draft.health.lastOnchainStateFailure = safeError(error);
          draft.health.onchainRpc = this.stateRpc.circuitSnapshot?.();
        }).catch(() => {});
      }
      finally { clearTimeout(deadline); }
      await delay(Math.max(50, this.config.onchainStateIntervalMs), signal);
    }
  }

  async runOnchainStateCycle(now = new Date(), signal) {
    const before = this.store.read();
    const scheduled = structuredClone(before);
    if (hasOnchainSeedCandidate(scheduled, now)) seedOnchainQueue(scheduled, now);
    const dueNow = (scheduled.onchainQueue ?? []).filter((item) => !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now.getTime());
    const rpcDue = dueNow.filter((item) => poolNeedsOnchainRpc(before, item)).slice(0, this.config.onchainStateBatchSize);
    const localDue = dueNow.filter((item) => !poolNeedsOnchainRpc(before, item)).slice(0, this.config.onchainLocalClassificationBatchSize ?? 128);
    const due = [...rpcDue, ...localDue];
    if (!due.length) return before;
    const needsRpc = rpcDue.length > 0;
    const blockNumber = needsRpc ? await this.stateRpc.blockNumber({ signal }) : before.confirmedHead;
    const blockRow = needsRpc ? await this.stateRpc.getBlock(blockNumber, { signal }) : undefined;
    const blockTime = blockRow?.timestamp ? Number.parseInt(blockRow.timestamp, 16) * 1_000 : now.getTime();
    const block = { number: blockNumber, hash: blockRow?.hash?.toLowerCase(), observedAt: Number.isFinite(blockTime) ? new Date(blockTime).toISOString() : now.toISOString() };
    const outcomes = await Promise.all(due.map(async (item) => {
      const pool = before.pools[item.poolKey];
      if (!pool || pool.status !== "confirmed" || pool.orphaned || pool.replay) return { item, state: undefined, remove: true };
      const adapter = resolveOnchainAdapter(pool);
      if (!adapter) return { item, state: unsupportedOnchainState(pool, now) };
      try {
        return { item, state: await readPoolOnchainState(this.stateRpc, pool, before.tokenMetadata, block, { signal }) };
      } catch (error) {
        return { item, state: { ...unsupportedOnchainState(pool, now), status: "retryable", adapterFamily: adapter.adapterFamily, protocolFamily: adapter.protocolFamily, confidence: "unavailable", reasonCode: error?.reasonCode ?? "onchain_state_read_failed", retryable: true } };
      }
    }));
    const touchedPoolKeys = outcomes.flatMap((outcome) => outcome.remove ? [] : [outcome.item.poolKey]);
    const after = await this.store.transact("bounded-onchain-pool-state", (draft) => {
      ensureEnrichmentState(draft);
      seedOnchainQueue(draft, now);
      const remove = new Set();
      for (const outcome of outcomes) {
        const key = outcome.item.poolKey;
        const pool = draft.pools[key];
        if (!pool || outcome.remove) { remove.add(key); continue; }
        const observed = outcome.state;
        const acceptance = acceptOnchainStateUpdate(pool.onchainState, observed);
        if (!acceptance.accepted) {
          if (acceptance.reasonCode === "duplicate_state_snapshot") draft.counters.onchainStateDuplicate += 1;
          else draft.counters.onchainStateOutOfOrder += 1;
          if (pool.onchainState) draft.pools[key] = { ...pool, onchainState: { ...pool.onchainState, nextRetryAt: new Date(now.getTime() + ONCHAIN_STATE_REFRESH_MS).toISOString(), lastRejectedUpdate: acceptance.reasonCode } };
          remove.add(key);
          continue;
        }
        const queued = draft.onchainQueue.find((item) => item.poolKey === key);
        const attempts = observed.status === "retryable" || observed.status === "pending" ? (outcome.item.attempts ?? 0) + 1 : 0;
        const refreshMs = observed.status === "complete" ? ONCHAIN_STATE_REFRESH_MS
          : observed.status === "unsupported" ? 6 * 60 * 60_000
            : observed.status === "rejected" ? observed.reasonCode === "zero_liquidity" ? ONCHAIN_STATE_REFRESH_MS : 60 * 60_000
              : Math.min(15 * 60_000, 15_000 * 2 ** Math.min(attempts, 6));
        const nextRetryAt = new Date(now.getTime() + refreshMs).toISOString();
        draft.pools[key] = { ...pool, onchainState: { ...observed, nextRetryAt }, decimalsVerified: Number.isInteger(observed.decimals0) && Number.isInteger(observed.decimals1) };
        if (queued) Object.assign(queued, { attempts, nextAttemptAt: nextRetryAt, lastReason: observed.reasonCode });
        if (observed.status === "complete") draft.counters.onchainStateSuccess += 1;
        else draft.counters.onchainStateFailure += 1;
        draft.counters.onchainStateClassified += 1;
        remove.add(key);
      }
      draft.onchainQueue = draft.onchainQueue.filter((item) => !remove.has(item.poolKey));
      seedOnchainQueue(draft, now);
      draft.health.onchainQueueDepth = draft.onchainQueue.length;
      draft.health.onchainRpc = this.stateRpc.circuitSnapshot?.();
      draft.health.lastOnchainStateCycle = now.toISOString();
    }, (draft) => appendSemanticDeltas(draft, before, touchedPoolKeys));
    return after;
  }

  async runEnrichmentLoop(signal) {
    while (this.running && !signal?.aborted) {
      if (!storeDerivedCyclesReady(this.store)) {
        await delay(DERIVED_CYCLE_BACKFILL_DELAY_MS, signal);
        continue;
      }
      try { await this.runEnrichmentCycle(); }
      catch (error) {
        await this.store.transact("enrichment-cycle-failure", (draft) => {
          ensureEnrichmentState(draft);
          draft.counters.enrichmentFailure += 1;
          draft.health.lastEnrichmentFailure = safeError(error);
          refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
        }).catch(() => {});
      }
      await delay(Math.max(50, this.config.enrichmentIntervalMs), signal);
    }
  }

  async runEnrichmentCycle(now = new Date()) {
    const before = this.store.read();
    const scheduled = structuredClone(before);
    if (hasEnrichmentSeedCandidate(scheduled, now)) seedEnrichmentQueue(scheduled, now);
    const due = (scheduled.enrichmentQueue ?? [])
      .filter((item) => !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now.getTime())
      .slice(0, this.config.enrichmentBatchSize);
    if (!due.length) return before;
    const outcomes = await Promise.all(due.map(async (item) => {
      const pool = before.pools[item.poolKey];
      if (!pool?.poolAddress || pool.status !== "confirmed" || pool.orphaned) return { item, status: "discarded", reasonCode: "pool_no_longer_eligible" };
      try {
        const lookup = await this.provider.lookupPool(pool.poolAddress);
        const metadata = before.tokenMetadata;
        const metadataUpdates = {};
        const decimalsVerified = [pool.token0, pool.token1].every((token) => Number.isInteger(metadata[token]?.decimals));
        const onchainState = pool.onchainState;
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
    const touchedPoolKeys = outcomes.map((outcome) => outcome.item.poolKey);
    const after = await this.store.transact("bounded-pool-financial-enrichment", (draft) => {
      ensureEnrichmentState(draft);
      seedEnrichmentQueue(draft, now);
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
            providerPriceToken1PerToken0: joined.providerPriceToken1PerToken0,
            priceUsd: joined.priceUsd,
            observedPricesUsd: joined.observedPricesUsd,
            liquidityUsd: joined.liquidityUsd,
            providerLiquidityUsd: joined.providerLiquidityUsd,
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
    }, (draft) => appendSemanticDeltas(draft, before, touchedPoolKeys));
    return after;
  }

  async runAnchorLoop(signal) {
    while (this.running && !signal?.aborted) {
      if (!storeDerivedCyclesReady(this.store)) {
        await delay(DERIVED_CYCLE_BACKFILL_DELAY_MS, signal);
        continue;
      }
      const startedAt = Date.now();
      const cycleController = new AbortController();
      const cycleSignal = signal ? AbortSignal.any([signal, cycleController.signal]) : cycleController.signal;
      let deadline;
      try {
        const timeoutMs = this.config?.anchorCycleTimeoutMs ?? 45_000;
        const timeout = new Promise((_, reject) => {
          deadline = setTimeout(() => {
            cycleController.abort();
            const error = new Error("anchor_refresh_deadline_exceeded");
            error.reasonCode = "anchor_refresh_deadline_exceeded";
            reject(error);
          }, timeoutMs);
        });
        await Promise.race([this.refreshAnchorIfDue(new Date(), cycleSignal), timeout]);
      } catch (error) {
        await this.store.transact("trusted-anchor-loop-failure", (draft) => {
          ensureEnrichmentState(draft);
          const failedAt = new Date();
          draft.health.lastAnchorLoopFailure = safeError(error);
          draft.priceAnchors.wethUsdc.nextRefreshAt = new Date(failedAt.getTime() + 10_000).toISOString();
          draft.counters.enrichmentFailure += 1;
          refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
        }).catch(() => {});
      } finally {
        clearTimeout(deadline);
      }
      if (!this.running || signal?.aborted) break;
      const intervalMs = this.config?.anchorLoopIntervalMs ?? 5_000;
      await delay(Math.max(1, intervalMs - (Date.now() - startedAt)), signal);
    }
  }

  async refreshAnchorIfDue(now = new Date(), signal) {
    const before = this.store.read();
    const current = before.priceAnchors?.wethUsdc;
    if (current?.nextRefreshAt && Date.parse(current.nextRefreshAt) > now.getTime()) return before;
    try {
      const trustedPoolAddresses = [...new Set([...(current?.candidates ?? []), ...(current?.lastTrustedCandidates ?? [])]
        .flatMap((candidate) => trustedAnchorPoolIdentity(current, candidate?.poolAddress) ? [candidate.poolAddress] : []))];
      const observations = selectAnchorValidationCandidates(await this.anchorProvider.lookupWethPools({ signal, poolAddresses: trustedPoolAddresses }));
      const lookupCompletedAt = new Date();
      const blockNumber = before.currentHead || await this.anchorRpc.blockNumber({ signal });
      const metadata = { ...before.tokenMetadata };
      for (const token of [BASE_WETH, BASE_USDC]) {
        if (!Number.isInteger(metadata[token]?.decimals)) {
          const exactDecimals = await readTokenDecimals(this.anchorRpc, token, "latest", { signal });
          metadata[token] = exactDecimals.ok
            ? { ...metadata[token], address: token, decimals: exactDecimals.decimals, codeExists: true, observedAt: exactDecimals.observedAt, blockNumber, status: metadata[token]?.name && metadata[token]?.symbol ? "complete" : "partial" }
            : metadata[token] ?? await enrichTokenMetadata(this.anchorRpc, token, blockNumber, now, { signal });
        }
      }
      const inspected = await mapWithConcurrency(observations, 2, async (observation) => {
        let pool = trustedAnchorPoolIdentity(current, observation.poolAddress);
        let onchainState;
        if (!pool) {
          const identity = await inspectRegisteredPool(this.anchorRpc, observation.poolAddress, "latest", { signal });
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
          onchainState = await readSupportedPoolState(this.anchorRpc, pool, metadata, "latest", { signal });
        }
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
      }, (draft) => appendSemanticDeltas(draft, before, []));
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

  async publishSemanticDeltas(before, _after, touchedPoolKeys) {
    return this.store.transact("semantic-enrichment-deltas", (draft) => appendSemanticDeltas(draft, before, touchedPoolKeys));
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
      if (Number.isInteger(this.lastObservedHead)) draft.currentHead = this.lastObservedHead;
      if (Number.isInteger(this.lastObservedConfirmedHead)) draft.confirmedHead = this.lastObservedConfirmedHead;
      const cursors = ENABLED.map((entry) => draft.cursors?.[entry.id]?.blockNumber ?? 0);
      const cursor = cursors.length ? Math.min(...cursors) : 0;
      const lagBlocks = Math.max(0, (draft.confirmedHead ?? 0) - cursor);
      draft.health.ready = false;
      draft.health.backfillState = "retrying";
      draft.health.lastFailure = safeError(error);
      draft.health.currentHead = draft.currentHead;
      draft.health.confirmedCursor = cursor;
      draft.health.lagBlocks = lagBlocks;
      draft.health.lagSeconds = lagBlocks * 2;
      if (this.config.websocketUrl && this.websocket?.readyState !== WebSocket.OPEN) draft.health.mode = "reconnecting";
    });
  }
}

function appendSemanticDeltas(draft, before, touchedPoolKeys) {
  const events = [];
  for (const poolKey of touchedPoolKeys) {
    const previousPool = before.pools?.[poolKey];
    const currentPool = draft.pools?.[poolKey];
    const previous = previousPool?.providerEnrichment?.status;
    const current = currentPool?.providerEnrichment?.status;
    if (previous !== "matched" && current === "matched") {
      events.push({ type: "pool_enriched", data: { poolKey, providers: currentPool.providerEnrichment.providers } });
      events.push({ type: "provider_pool_found", data: { poolKey, providerIndexedAt: currentPool.providerIndexedAt } });
    }
    if (previous !== "pending" && current === "pending") events.push({ type: "provider_pool_pending", data: { poolKey, reasonCode: currentPool.providerEnrichment.reasonCode } });
    if (semanticOnchainState(previousPool?.onchainState) !== semanticOnchainState(currentPool?.onchainState)) {
      events.push({ type: "pool_onchain_state_observed", data: { poolKey, adapterFamily: currentPool?.onchainState?.adapterFamily, status: currentPool?.onchainState?.status, reasonCode: currentPool?.onchainState?.reasonCode, blockNumber: currentPool?.onchainState?.blockNumber, blockHash: currentPool?.onchainState?.blockHash } });
    }
    if (previousPool?.priceReconciliation?.status !== "conflict" && currentPool?.priceReconciliation?.status === "conflict") {
      events.push({ type: "price_conflict_detected", data: { poolKey, ...currentPool.priceReconciliation, providerObservedAt: currentPool.marketObservedAt, onchainObservedAt: currentPool.onchainState?.observedAt, blockNumber: currentPool.onchainState?.blockNumber } });
    }
  }
  const beforeAnchor = semanticAnchor(before.priceAnchors?.wethUsdc);
  const afterAnchor = semanticAnchor(draft.priceAnchors?.wethUsdc);
  if (beforeAnchor !== afterAnchor) events.push({ type: "anchor_updated", data: { anchor: BASE_WETH, quote: BASE_USDC, status: draft.priceAnchors?.wethUsdc?.status, value: draft.priceAnchors?.wethUsdc?.value, sourcePoolCount: draft.priceAnchors?.wethUsdc?.sourcePoolCount } });
  const previousById = new Map((before.opportunities ?? []).map((item) => [item.id, item]));
  for (const opportunity of draft.opportunities ?? []) {
    const previous = previousById.get(opportunity.id);
    if (previous?.canonicalPrice?.tier === "UNPRICED" && opportunity.canonicalPrice.tier !== "UNPRICED") events.push({ type: "opportunity_priced", data: { opportunityId: opportunity.id, tier: opportunity.canonicalPrice.tier, value: opportunity.canonicalPrice.value } });
    if (previous && semanticCanonicalPrice(previous.canonicalPrice) !== semanticCanonicalPrice(opportunity.canonicalPrice)) events.push({ type: "opportunity_canonical_price", data: { opportunityId: opportunity.id, tier: opportunity.canonicalPrice.tier, value: opportunity.canonicalPrice.value, sourcePoolKeys: opportunity.canonicalPrice.sourcePoolKeys, reasonCode: opportunity.canonicalPrice.reasonCode } });
    if (previous?.canonicalPrice?.tier !== "UNPRICED" && opportunity.canonicalPrice.tier === "UNPRICED") events.push({ type: "opportunity_unpriced", data: { opportunityId: opportunity.id, reasonCode: opportunity.canonicalPrice.reasonCode } });
    if (!previous?.ranked && opportunity.ranked) events.push({ type: "opportunity_activated", data: { opportunityId: opportunity.id, tier: opportunity.canonicalPrice.tier } });
    if (previous && semanticObservedPrice(previous.observedPriceUsd) !== semanticObservedPrice(opportunity.observedPriceUsd)) events.push({ type: "opportunity_observed_price", data: { opportunityId: opportunity.id, value: opportunity.observedPriceUsd?.value, provider: opportunity.observedPriceUsd?.provider, poolAddress: opportunity.observedPriceUsd?.poolAddress, reasonCode: opportunity.observedPriceUsd?.reasonCode } });
    if (previous && (previous.liquidityState !== opportunity.liquidityState || previous.bestLiquidityUsd !== opportunity.bestLiquidityUsd)) events.push({ type: "opportunity_liquidity_resolved", data: { opportunityId: opportunity.id, liquidityState: opportunity.liquidityState, bestLiquidityUsd: opportunity.bestLiquidityUsd } });
    if (previous && previous.qualityBand !== opportunity.qualityBand) events.push({ type: "opportunity_band_changed", data: { opportunityId: opportunity.id, previousBand: previous.qualityBand, band: opportunity.qualityBand } });
    if (!previous?.ranked && opportunity.ranked) events.push({ type: "opportunity_ranked", data: { opportunityId: opportunity.id, band: opportunity.qualityBand } });
    if (previous?.ranked && !opportunity.ranked) events.push({ type: "opportunity_unranked", data: { opportunityId: opportunity.id, reasonCode: opportunity.exclusionReason } });
    if (previous && semanticMetrics(previous) !== semanticMetrics(opportunity)) events.push({ type: "metrics_updated", data: { opportunityId: opportunity.id, aggregate: opportunity.aggregate } });
  }
  const at = new Date().toISOString();
  for (const event of events) appendRelayEvent(draft, event.type, event.data, at);
  draft.counters.bandTransitions += events.filter((event) => event.type === "opportunity_band_changed").length;
  draft.health.bandTransitions = draft.counters.bandTransitions;
  return draft;
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
  state.onchainQueue ??= [];
  state.metadataQueue ??= [];
  state.priceAnchors ??= {};
  state.priceAnchors.wethUsdc ??= { status: "unavailable", reasonCode: "not_initialized", sourcePoolCount: 0, freshness: "unavailable" };
  state.counters ??= {};
  for (const key of ["reconnectCount", "reorgCount", "duplicateDropped", "malformedRejected", "enrichmentSuccess", "enrichmentFailure", "providerMatched", "providerUnmatched", "priceConflict", "staleAnchorRejected", "dustRejected", "exactLookupSuccess", "exactLookupPending", "exactLookupNotFound", "bandTransitions", "onchainStateSuccess", "onchainStateFailure", "onchainStateClassified", "onchainStateDuplicate", "onchainStateOutOfOrder", "tokenMetadataVerified"]) {
    if (!Number.isFinite(state.counters[key])) state.counters[key] = 0;
  }
  state.health ??= {};
  for (const metadata of Object.values(state.tokenMetadata ?? {})) {
    if (!metadata.verificationState && Number.isInteger(metadata.decimals) && metadata.decimals >= 0 && metadata.decimals <= 255) {
      metadata.verificationState = "verified";
      metadata.source ??= "erc20_contract";
      metadata.retryable = false;
    }
  }
}

function seedMetadataQueue(state, now) {
  const queued = new Set((state.metadataQueue ?? []).map((item) => item.tokenAddress));
  const tokens = [...new Set(Object.values(state.pools ?? {}).flatMap((pool) => [pool.token0, pool.token1]))].filter(Boolean).sort();
  const jobs = [];
  for (const token of tokens) {
    const metadata = state.tokenMetadata?.[token];
    if (metadata?.verificationState === "verified" || metadata?.verificationState === "quarantined" || queued.has(token)) continue;
    const retryAt = Date.parse(metadata?.retryAt ?? "");
    if (Number.isFinite(retryAt) && retryAt > now.getTime()) continue;
    jobs.push({ poolKey: token, tokenAddress: token, blockNumber: state.confirmedHead || state.currentHead, attempts: 0, createdAt: now.toISOString(), nextAttemptAt: now.toISOString() });
  }
  state.metadataQueue = coalesceBoundedQueue(state.metadataQueue ?? [], jobs, 256);
}

function seedOnchainQueue(state, now) {
  const queued = new Set((state.onchainQueue ?? []).map((item) => item.poolKey));
  const candidates = Object.values(state.pools ?? {}).filter((pool) => {
    if (pool.status !== "confirmed" || pool.orphaned || pool.replay || queued.has(pool.poolKey)) return false;
    const retryAt = Date.parse(pool.onchainState?.nextRetryAt ?? "");
    return !Number.isFinite(retryAt) || retryAt <= now.getTime();
  }).sort((left, right) => Number(Boolean(resolveOnchainAdapter(right) && right.poolAddress)) - Number(Boolean(resolveOnchainAdapter(left) && left.poolAddress)) || left.poolKey.localeCompare(right.poolKey));
  const jobs = candidates.map((pool) => ({
    poolKey: pool.poolKey,
    poolAddress: pool.poolAddress,
    attempts: 0,
    createdAt: now.toISOString(),
    nextAttemptAt: now.toISOString()
  }));
  const combined = new Map([...(state.onchainQueue ?? []), ...jobs].map((item) => [item.poolKey, item]));
  state.onchainQueue = [...combined.values()].sort((left, right) => {
    const leftPool = state.pools?.[left.poolKey];
    const rightPool = state.pools?.[right.poolKey];
    const adapterPriority = Number(Boolean(resolveOnchainAdapter(rightPool) && rightPool?.poolAddress)) - Number(Boolean(resolveOnchainAdapter(leftPool) && leftPool?.poolAddress));
    const createdPriority = Date.parse(left.createdAt ?? "") - Date.parse(right.createdAt ?? "");
    return adapterPriority || (Number.isFinite(createdPriority) ? createdPriority : 0) || left.poolKey.localeCompare(right.poolKey);
  }).slice(0, 512);
  state.health ??= {};
  state.health.onchainQueueDepth = state.onchainQueue.length;
}

function poolNeedsOnchainRpc(state, item) {
  const pool = state.pools?.[item.poolKey];
  return Boolean(pool?.poolAddress
    && resolveOnchainAdapter(pool)
    && validTokenDecimals(state.tokenMetadata?.[pool.token0]?.decimals)
    && validTokenDecimals(state.tokenMetadata?.[pool.token1]?.decimals));
}

function hasOnchainSeedCandidate(state, now) {
  const queued = new Set((state.onchainQueue ?? []).map((item) => item.poolKey));
  return Object.values(state.pools ?? {}).some((pool) => pool.status === "confirmed" && !pool.orphaned && !pool.replay && !queued.has(pool.poolKey)
    && (!pool.onchainState?.nextRetryAt || Date.parse(pool.onchainState.nextRetryAt) <= now.getTime()));
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
  const liquidityStates = { liquidity_unknown: 0, thin_liquidity: 0, zero_liquidity: 0, usable_liquidity: 0, conflicting_liquidity: 0, stale_liquidity: 0 };
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
    conflictingLiquidityCount: liquidityStates.conflicting_liquidity,
    staleLiquidityCount: liquidityStates.stale_liquidity,
    exactLookupQueueDepth: state.enrichmentQueue?.length ?? 0,
    exactLookupSuccess: matched.length,
    exactLookupPending: pending.length,
    exactLookupNotFound: pools.filter((pool) => pool.providerEnrichment?.exactLookupState === "not_found").length,
    providerIndexingLatencyMs: summarizeLatency(indexingLatencies),
    bandTransitions: state.counters.bandTransitions,
    categoryEligibilityCounts,
    oldestPendingEnrichment: pendingTimes[0],
    providerCircuits: circuits,
    onchainRpc: state.health.onchainRpc,
    onchainQueueDepth: state.onchainQueue?.length ?? 0,
    onchainSupportedPools: pools.filter((pool) => Boolean(resolveOnchainAdapter(pool))).length,
    onchainStateStatusCounts: countBy(pools, (pool) => pool.onchainState?.status ?? "not_collected"),
    onchainStateReasonCounts: countBy(pools, (pool) => pool.onchainState?.reasonCode ?? "not_collected"),
    metadataVerificationCounts: countBy(Object.values(state.tokenMetadata ?? {}), (metadata) => metadata.verificationState ?? (Number.isInteger(metadata.decimals) ? "legacy_verified" : "pending")),
    priceConflictCount: state.counters.priceConflict,
    staleAnchorRejectionCount: state.counters.staleAnchorRejected,
    dustRejectionCount: state.counters.dustRejected
  };
}

function semanticAnchor(anchor) {
  return JSON.stringify({ status: anchor?.status, value: Number.isFinite(anchor?.value) ? Number(anchor.value.toPrecision(10)) : undefined, pools: anchor?.consensusPools, reasonCode: anchor?.reasonCode });
}

function semanticOnchainState(state) {
  return JSON.stringify({ status: state?.status, adapterFamily: state?.adapterFamily, reasonCode: state?.reasonCode, rate: precision(state?.observedPrice0In1), reserve0: state?.reserveEvidence?.reserve0Raw, reserve1: state?.reserveEvidence?.reserve1Raw, balance0: state?.balanceEvidence?.balance0Raw, balance1: state?.balanceEvidence?.balance1Raw });
}

function semanticCanonicalPrice(value) { return JSON.stringify({ tier: value?.tier, value: precision(value?.value), reasonCode: value?.reasonCode, sourcePoolKeys: value?.sourcePoolKeys }); }
function semanticObservedPrice(value) { return JSON.stringify({ value: precision(value?.value), provider: value?.provider, poolAddress: value?.poolAddress, freshness: value?.freshness, reasonCode: value?.reasonCode }); }
function precision(value) { return Number.isFinite(value) ? Number(value.toPrecision(12)) : undefined; }
function countBy(values, selector) { const result = {}; for (const value of values) { const key = selector(value); result[key] = (result[key] ?? 0) + 1; } return result; }

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

export async function verifyFactoryEvents(rpc, events, concurrency = 4, { signal, managerCodeEvidence } = {}) {
  if (typeof rpc?.batchOutcomes === "function") {
    const bindings = await verifyPoolBindings(rpc, events, { signal, managerCodeEvidence });
    if (bindings.some((binding) => !binding.ok && binding.retryable)) throw new Error("factory_binding_verification_unavailable");
    const accepted = events.flatMap((event, index) => bindings[index]?.ok ? [{ event, binding: bindings[index] }] : []);
    const blockNumbers = [...new Set(accepted.map(({ event }) => event.blockNumber))];
    const blockRows = new Map();
    for (let offset = 0; offset < blockNumbers.length; offset += PUBLIC_RPC_BLOCK_BATCH_CALL_LIMIT) {
      await rpc.paceBatch?.({ signal });
      const numbers = blockNumbers.slice(offset, offset + PUBLIC_RPC_BLOCK_BATCH_CALL_LIMIT);
      const outcomes = await rpc.batchOutcomes(numbers.map((blockNumber) => ({ method: "eth_getBlockByNumber", params: [`0x${blockNumber.toString(16)}`, false] })), { signal });
      if (outcomes.some((outcome) => !outcome.ok)) throw new Error("factory_block_evidence_unavailable");
      for (let index = 0; index < numbers.length; index += 1) blockRows.set(numbers[index], outcomes[index].value);
    }
    return accepted.map(({ event, binding }) => {
      const block = blockRows.get(event.blockNumber);
      const timestampSeconds = block?.timestamp ? Number.parseInt(block.timestamp, 16) : undefined;
      return {
        ...event,
        provisional: false,
        verifiedBinding: binding.kind,
        blockTimestamp: Number.isFinite(timestampSeconds) ? new Date(timestampSeconds * 1_000).toISOString() : undefined
      };
    });
  }
  const blockCache = new Map();
  const verified = await mapWithConcurrency(events, concurrency, async (event) => {
    const binding = await verifyPoolBinding(rpc, event, event.blockNumber);
    if (!binding.ok) return undefined;
    let blockPromise = blockCache.get(event.blockNumber);
    if (!blockPromise) {
      blockPromise = rpc.getBlock(event.blockNumber);
      blockCache.set(event.blockNumber, blockPromise);
    }
    const block = await blockPromise;
    const timestampSeconds = block?.timestamp ? Number.parseInt(block.timestamp, 16) : undefined;
    return {
      ...event,
      provisional: false,
      verifiedBinding: binding.kind,
      blockTimestamp: Number.isFinite(timestampSeconds) ? new Date(timestampSeconds * 1_000).toISOString() : undefined
    };
  });
  return verified.filter(Boolean);
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
