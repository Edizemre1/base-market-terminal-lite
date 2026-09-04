import { BASE_CHAIN_ID, BASE_USDC, BASE_WETH, COLLECTOR_VERSION, FACTORY_REGISTRY } from "./factory-registry.mjs";
import { appendRelayEvent, applyCanonicalEvents, buildCanonicalOpportunities, coalesceBoundedQueue, decodeFactoryLog, reconcileCanonicalWindow } from "./model.mjs";
import { enrichTokenMetadata, inspectRegisteredPool, JsonRpcRequestError, readTokenDecimals, verifyPoolBinding, verifyPoolBindings } from "./rpc.mjs";
import { configuredRpcEndpoints, RpcTransportPool, validBlock } from "./rpc-transport.mjs";
import { throwIfAborted, withDeadline } from "./async-control.mjs";
import { seedBackfillQueue, recordBackfillOutcome, backfillHealth, backfillPriority, selectBackfillRpcBatch } from "./pool-backfill.mjs";
import { DurableDiscoveryStore, pricingPoolsForState } from "./store.mjs";
import { acceptOnchainStateUpdate, readPoolOnchainState, resolveOnchainAdapter, unsupportedOnchainState, validTokenDecimals } from "./onchain-state.mjs";
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
const MINIMUM_DISCOVERY_IDLE_MS = 3_000;
const NORMAL_POLL_INTERVAL_MS = 10_000;
const NORMAL_DERIVED_INTERVAL_MS = 30_000;

export function nextScanDelayMs(pollIntervalMs, elapsedMs) {
  return Math.max(MINIMUM_DISCOVERY_IDLE_MS, pollIntervalMs - Math.max(0, elapsedMs));
}

export function resolveCollectorConfig(environment = process.env) {
  const httpUrl = environment.BASE_RPC_HTTP_URL?.trim() || "https://mainnet.base.org";
  const websocketUrl = environment.BASE_RPC_WS_URL?.trim();
  return {
    httpUrl,
    rpcEndpoints: configuredRpcEndpoints(environment),
    websocketUrl: websocketUrl && /^wss?:\/\//i.test(websocketUrl) ? websocketUrl : undefined,
    storeDirectory: environment.ONCHAIN_STORE_PATH?.trim() || ".data/onchain-discovery",
    pollIntervalMs: boundedInteger(environment.ONCHAIN_POLL_INTERVAL_MS, NORMAL_POLL_INTERVAL_MS, 1_000, 60_000),
    bootstrapBlocks: boundedInteger(environment.ONCHAIN_BOOTSTRAP_BLOCKS, 2_000, 64, 10_000),
    maximumChunksPerPass: boundedInteger(environment.ONCHAIN_MAX_CHUNKS_PER_PASS, 4, 1, 16),
    metadataBatchSize: boundedInteger(environment.ONCHAIN_METADATA_BATCH_SIZE, 1, 1, 32),
    onchainStateBatchSize: boundedInteger(environment.ONCHAIN_STATE_BATCH_SIZE, 4, 1, 12),
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
    this.transport = config.transport ?? new RpcTransportPool(config.rpcEndpoints ?? [{ label: "primary", url: config.httpUrl }], { timeoutMs: Math.min(8_000, config.providerTimeoutMs ?? 8_000) });
    this.rpc = config.rpcClient ?? this.transport.client({ purpose: "binding" });
    this.discoveryRpc = config.discoveryRpcClient ?? this.transport.client({ batchPaceMs: config.discoveryBatchPaceMs ?? 3_000, purpose: "discovery" });
    this.stateRpc = config.stateRpcClient ?? this.transport.client({ purpose: "pool_state" });
    this.provider = config.providerClient ?? new ProviderEnrichmentClient({ timeoutMs: config.providerTimeoutMs });
    // Anchor availability is a pricing safety boundary. Keep its provider
    // request and bounded RPC validation independent from the normal exact-pool
    // backlog so queued enrichment cannot age out a healthy anchor.
    this.anchorProvider = config.anchorProviderClient ?? new ProviderEnrichmentClient({
      timeoutMs: config.providerTimeoutMs,
      retries: 0
    });
    this.anchorRpc = config.anchorRpcClient ?? this.transport.client({ purpose: "anchor" });
    this.store = new DurableDiscoveryStore(config.storeDirectory);
    this.running = false;
    this.websocket = undefined;
    this.websocketReconnectTimer = undefined;
    this.websocketRequestId = 1;
    this.lastObservedHead = undefined;
    this.lastObservedConfirmedHead = undefined;
    this.managerCodeEvidence = new Map();
    this.loopHealth = {};
    this.proofCost = { successfulProofs: 0 };
  }

  async open() {
    await this.store.open();
    const state = await this.store.transact("initialize-enrichment-state", (draft) => {
      ensureEnrichmentState(draft);
      seedEnrichmentQueue(draft, new Date());
      seedMetadataQueue(draft, new Date());
      seedOnchainQueue(draft, new Date());
    });
    this.updateContinuity(state);
    if (this.config.websocketUrl) this.startWebsocket();
    return state;
  }

  async run(signal) {
    this.running = true;
    await Promise.all([
      this.runLoop("head", 10_000, 25_000, (child) => this.reconcileHead(child), signal),
      this.runLoop("ingestion", this.config.pollIntervalMs, 45_000, (child) => this.scanOnce(child), signal),
      this.runLoop("metadata", 10_000, 25_000, (child) => this.drainMetadata(child), signal),
      this.runEnrichmentLoop(signal), this.runAnchorLoop(signal), this.runOnchainStateLoop(signal)
    ]);
  }

  async runLoop(name, intervalMs, timeoutMs, operation, signal) {
    this.loopHealth ??= {};
    while (this.running && !signal?.aborted) {
      const startedAt = Date.now();
      const previous = this.loopHealth[name] ?? {};
      this.loopHealth[name] = { ...previous, phase: "running", startedAt: new Date(startedAt).toISOString() };
      try {
        const outcome = await withDeadline(operation, timeoutMs, { signal, reasonCode: `${name}_cycle_deadline_exceeded` });
        const successAt = new Date().toISOString();
        this.loopHealth[name] = outcome?.loopSkipped
          ? { ...previous, phase: previous.lastError && !previous.lastError.recoveredAt ? "retrying" : "idle" }
          : { ...this.loopHealth[name], phase: "idle", lastSuccessAt: successAt, retryAt: undefined, lastError: previous.lastError ? { ...previous.lastError, recoveredAt: previous.lastError.recoveredAt ?? successAt } : undefined };
      } catch (error) {
        if (signal?.aborted) break;
        const failure = { reasonCode: safeError(error), method: error?.method, endpointLabel: error?.endpointLabel, observedAt: new Date().toISOString(), retryAt: new Date(Date.now() + intervalMs).toISOString() };
        this.loopHealth[name] = { ...this.loopHealth[name], phase: "retrying", lastError: failure, retryAt: failure.retryAt };
        // Structured journal output contains no raw provider message or URL.
        console.warn(JSON.stringify({ event: "collector_loop_failure", loop: name, ...failure }));
        if (name === "ingestion") await this.recordFailure(error).catch(() => {});
      }
      // Heartbeat is bounded and separate from all remote I/O. The store's
      // transaction tail serializes publication and preserves the last commit.
      await this.store.transact(`loop-${name}-status`, (draft) => {
        draft.health.loops = { ...draft.health.loops, ...structuredClone(this.loopHealth) };
        draft.health.rpc = this.transport?.snapshot();
        draft.health.lastAnchorLoopFailure = this.loopHealth.anchor?.lastError?.reasonCode;
        draft.health.lastOnchainStateFailure = this.loopHealth.pool_state?.lastError?.reasonCode;
      }, undefined, { derive: false }).catch(() => {});
      if (!this.running || signal?.aborted) break;
      await delay(Math.max(1_000, intervalMs - (Date.now() - startedAt)), signal);
    }
  }

  updateContinuity(state) {
    const rows = Object.values(state.cursors ?? {}).filter((row) => row.blockNumber > 0).sort((left, right) => left.blockNumber - right.blockNumber);
    if (rows[0]) this.transport?.setContinuity({ number: rows[0].blockNumber, hash: rows[0].blockHash });
  }

  async reconcileHead(signal) {
    this.updateContinuity(this.store.read());
    const head = await this.rpc.blockNumber({ signal });
    const confirmedHead = Math.max(0, head - Math.max(...ENABLED.map((entry) => entry.confirmationPolicy.confirmations)));
    if (this.transport) this.transport.minimumHead = Math.max(this.transport.minimumHead, confirmedHead);
    this.lastObservedHead = head; this.lastObservedConfirmedHead = confirmedHead;
    throwIfAborted(signal);
    return this.store.transact("independent-head-reconciliation", (draft) => {
      throwIfAborted(signal);
      draft.currentHead = head; draft.confirmedHead = confirmedHead;
      draft.health = buildHealth(draft, head, confirmedHead, this.config.websocketUrl ? "websocket" : "confirmed_polling");
      draft.health.lastHeadObservedAt = new Date().toISOString();
    }, undefined, { derive: false });
  }

  async scanOnce(signal) {
    const head = this.lastObservedHead ?? await this.rpc.blockNumber({ signal });
    const confirmations = Math.max(...ENABLED.map((entry) => entry.confirmationPolicy.confirmations));
    const confirmedHead = Math.max(0, head - confirmations);
    this.lastObservedHead = head;
    this.lastObservedConfirmedHead = confirmedHead;
    let state = this.store.read();
    const cursors = ENABLED.map((entry) => state.cursors?.[entry.id]?.blockNumber ?? 0);
    if (cursors.some((cursor) => cursor <= 0)) {
      const initialCursor = Math.max(1, confirmedHead - this.config.bootstrapBlocks - 1);
      state = await this.store.transact("initialize-bounded-cursors", (draft) => {
        throwIfAborted(signal);
        for (const entry of ENABLED) draft.cursors[entry.id] = { blockNumber: initialCursor, blockHash: undefined, updatedAt: new Date().toISOString() };
        draft.currentHead = head;
        draft.confirmedHead = confirmedHead;
        draft.health.backfillState = "catching_up";
      });
    }

    let cursor = Math.min(...ENABLED.map((entry) => state.cursors[entry.id].blockNumber));
    let chunks = 0;
    // One durable window per tick prevents a later RPC error from discarding
    // earlier verified progress. Never advance a cursor past an uncommitted log.
    while (cursor < confirmedHead && chunks < 1) {
      const maximumChunk = Math.min(...ENABLED.map((entry) => entry.confirmationPolicy.maximumChunkBlocks));
      const overlap = Math.max(...ENABLED.map((entry) => entry.confirmationPolicy.overlapBlocks));
      const fromBlock = Math.max(1, cursor - overlap + 1);
      let toBlock = Math.min(confirmedHead, cursor + maximumChunk);
      let rawLogs;
      let decoded;
      for (;;) {
        rawLogs = await this.rpc.getLogs({
          fromBlock,
          toBlock,
          addresses: ENABLED.map((entry) => entry.address),
          topics: [...new Set(ENABLED.map((entry) => entry.eventTopic))]
        }, { signal });
        decoded = rawLogs.map((log) => decodeFactoryLog(log)).filter(Boolean);
        if (rawLogs.length !== decoded.length) throw new JsonRpcRequestError("factory_malformed_log_window", { retryable: false, method: "eth_getLogs" });
        const newBindingCount = decoded.filter((event) => !knownFactoryBinding(state.events?.[event.idempotencyKey], event)).length;
        if (newBindingCount <= 16 || toBlock <= cursor + 1) break;
        toBlock = Math.max(cursor + 1, cursor + Math.floor((toBlock - cursor) / 2));
      }
      const confirmed = await verifyFactoryEvents(this.discoveryRpc, decoded, 2, { signal, managerCodeEvidence: this.managerCodeEvidence, knownEvents: state.events });
      const cursorBlock = validBlock(await this.rpc.getBlock(toBlock, { signal }), toBlock);
      throwIfAborted(signal);
      cursor = toBlock;
      chunks += 1;
      state = await this.store.transact("confirmed-log-reconciliation", (draft) => {
        throwIfAborted(signal);
        const next = reconcileCanonicalWindow(draft, confirmed, fromBlock, toBlock);
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
        for (const entry of ENABLED) next.cursors[entry.id] = { blockNumber: cursor, blockHash: cursorBlock.hash, updatedAt: committedAt.toISOString() };
        next.currentHead = Math.max(next.currentHead ?? 0, head);
        next.confirmedHead = Math.max(next.confirmedHead ?? 0, confirmedHead);
        next.health = buildHealth(next, next.currentHead, next.confirmedHead, this.config.websocketUrl ? (this.websocket?.readyState === WebSocket.OPEN ? "websocket" : "reconnecting") : "confirmed_polling");
        next.health.lastCursorProgressAt = committedAt.toISOString();
        next.health.lastFailure = undefined;
        return next;
      });
      this.updateContinuity(state);
    }
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

  async drainMetadata(signal) {
    const state = this.store.read();
    const now = new Date();
    const batch = (state.metadataQueue ?? []).filter((item) => !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now.getTime()).slice(0, this.config.metadataBatchSize);
    if (!batch.length) return;
    const results = Object.fromEntries(await Promise.all(batch.map(async (item) => [item.tokenAddress, await enrichTokenMetadata(this.rpc, item.tokenAddress, item.blockNumber, now, { signal })])));
    throwIfAborted(signal);
    await this.store.transact("bounded-token-metadata-enrichment", (draft) => {
      throwIfAborted(signal);
      const completed = new Set();
      for (const item of batch) {
        const previous = draft.tokenMetadata[item.tokenAddress];
        const result = results[item.tokenAddress];
        if (previous?.verificationState === "verified") { completed.add(item.tokenAddress); continue; }
        const attempts = (item.attempts ?? 0) + 1;
        const retryDelay = attempts % 6 === 0 ? 60 * 60_000 : Math.min(15 * 60_000, 15_000 * 2 ** Math.min(attempts, 6));
        const nextAttemptAt = new Date(now.getTime() + retryDelay).toISOString();
        draft.tokenMetadata[item.tokenAddress] = {
          ...result,
          retryAt: result.retryable ? nextAttemptAt : undefined,
          metadataBackfill: { ...previous?.metadataBackfill, attempts, createdAt: item.createdAt ?? now.toISOString(), nextAttemptAt, lastReason: result.failureReason, lastAttemptAt: now.toISOString() }
        };
        if (result.verificationState === "verified") {
          completed.add(item.tokenAddress);
          draft.counters.tokenMetadataVerified += 1;
          appendRelayEvent(draft, "token_metadata_verified", { tokenAddress: item.tokenAddress, decimals: result.decimals, blockNumber: result.blockNumber }, result.observedAt);
        } else if (!result.retryable) {
          completed.add(item.tokenAddress);
        } else {
          const queued = draft.metadataQueue.find((row) => row.tokenAddress === item.tokenAddress);
          if (queued) Object.assign(queued, { attempts, nextAttemptAt, lastReason: result.failureReason });
        }
      }
      draft.metadataQueue = draft.metadataQueue.filter((item) => !completed.has(item.tokenAddress));
      seedMetadataQueue(draft, now);
      draft.health.metadataQueueDepth = draft.metadataQueue.length;
    });
  }

  async runOnchainStateLoop(signal) {
    return this.runLoop("pool_state", this.config.onchainStateIntervalMs, this.config.onchainStateCycleTimeoutMs ?? 45_000, (child) => this.runOnchainStateCycle(new Date(), child), signal);
  }

  async runOnchainStateCycle(now = new Date(), signal) {
    const before = this.store.read();
    const scheduled = structuredClone(before);
    if (hasOnchainSeedCandidate(scheduled, now)) seedOnchainQueue(scheduled, now);
    const dueNow = (scheduled.onchainQueue ?? []).filter((item) => !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now.getTime());
    const rpcDue = selectBackfillRpcBatch(dueNow.filter((item) => poolNeedsOnchainRpc(before, item)), before.pools, this.config.onchainStateBatchSize, before.counters.backfillRpcAttempts ?? 0);
    const localDue = dueNow.filter((item) => !poolNeedsOnchainRpc(before, item)).slice(0, this.config.onchainLocalClassificationBatchSize ?? 128);
    const due = [...rpcDue, ...localDue];
    if (!due.length) return before;
    const needsRpc = rpcDue.length > 0;
    let block;
    try {
      const blockNumber = needsRpc ? Math.max(1, (await this.stateRpc.blockNumber({ signal })) - 2) : before.confirmedHead;
      const blockRow = needsRpc ? await this.stateRpc.getBlock(blockNumber, { signal }) : undefined;
      block = needsRpc ? { ...validBlock(blockRow, blockNumber), observedAt: new Date(Number.parseInt(blockRow.timestamp, 16) * 1_000).toISOString() } : { number: blockNumber, observedAt: now.toISOString() };
    } catch (error) {
      throwIfAborted(signal);
      block = { error };
    }
    const outcomes = await Promise.all(due.map(async (item) => {
      const pool = before.pools[item.poolKey];
      if (!pool || pool.status !== "confirmed" || pool.orphaned || pool.replay) return { item, state: undefined, remove: true };
      const adapter = resolveOnchainAdapter(pool);
      if (!adapter) return { item, state: unsupportedOnchainState(pool, now) };
      try {
        if (poolNeedsOnchainRpc(before, item) && block.error) throw block.error;
        return { item, state: await readPoolOnchainState(this.stateRpc, pool, before.tokenMetadata, block, { signal, blockProof: block.hash ? block : undefined, identityEvidence: pool.onchainState?.identityEvidence }) };
      } catch (error) {
        return { item, state: { ...unsupportedOnchainState(pool, now), status: "retryable", adapterFamily: adapter.adapterFamily, protocolFamily: adapter.protocolFamily, confidence: "unavailable", reasonCode: error?.reasonCode ?? "onchain_state_read_failed", endpointLabel: error?.endpointLabel, failureMethod: error?.method, retryable: true } };
      }
    }));
    throwIfAborted(signal);
    this.proofCost.successfulProofs += outcomes.filter(outcome => outcome.state?.status === "complete").length;
    const touchedPoolKeys = outcomes.flatMap((outcome) => outcome.remove ? [] : [outcome.item.poolKey]);
    let semanticBefore;
    const after = await this.store.transact("bounded-onchain-pool-state", (draft) => {
      throwIfAborted(signal);
      semanticBefore = semanticSnapshot(draft, touchedPoolKeys);
      ensureEnrichmentState(draft);
      seedOnchainQueue(draft, now);
      const remove = new Set();
      for (const outcome of outcomes) {
        const key = outcome.item.poolKey;
        const pool = draft.pools[key];
        if (!pool || outcome.remove) { remove.add(key); continue; }
        const observed = outcome.state;
        const acceptance = acceptOnchainStateUpdate(pool.onchainState, observed);
        const usedRpc = rpcDue.some((item) => item.poolKey === key);
        const recorded = acceptance.accepted ? observed : { status: "retryable", reasonCode: acceptance.reasonCode, endpointLabel: observed.endpointLabel };
        const nextRetryAt = recordBackfillOutcome(pool, recorded, now, { usedRpc });
        draft.counters.backfillProcessed = (draft.counters.backfillProcessed ?? 0) + 1;
        draft.counters.backfillRpcAttempts = (draft.counters.backfillRpcAttempts ?? 0) + Number(usedRpc);
        if (!acceptance.accepted) {
          if (acceptance.reasonCode === "duplicate_state_snapshot") draft.counters.onchainStateDuplicate += 1;
          else draft.counters.onchainStateOutOfOrder += 1;
          if (pool.onchainState) draft.pools[key] = { ...pool, onchainState: { ...pool.onchainState, nextRetryAt, lastRejectedUpdate: acceptance.reasonCode } };
          remove.add(key);
          continue;
        }
        // A failed refresh never erases last-good proof or renews its age.
        const retained = ["retryable", "pending"].includes(observed.status) && pool.onchainState?.status === "complete";
        draft.pools[key] = { ...pool, onchainState: { ...(retained ? pool.onchainState : observed), nextRetryAt }, decimalsVerified: retained ? pool.decimalsVerified : Number.isInteger(observed.decimals0) && Number.isInteger(observed.decimals1) };
        if (observed.status === "complete") draft.counters.onchainStateSuccess += 1;
        else draft.counters.onchainStateFailure += 1;
        draft.counters.onchainStateClassified += 1;
        draft.counters.poolIdentityCacheHits = (draft.counters.poolIdentityCacheHits ?? 0) + Number(observed.identityCacheHit);
        draft.counters.tokenDecimalsCacheHits = (draft.counters.tokenDecimalsCacheHits ?? 0) + (observed.tokenDecimalsCacheHits ?? 0);
        remove.add(key);
      }
      draft.onchainQueue = draft.onchainQueue.filter((item) => !remove.has(item.poolKey));
      seedOnchainQueue(draft, now);
      draft.health.onchainQueueDepth = draft.onchainQueue.length;
      draft.health.onchainRpc = this.stateRpc.circuitSnapshot?.();
      const usage = draft.health.onchainRpc?.byPurpose?.pool_state ?? {};
      draft.health.proofRpcCost = {
        actualRequests: usage.requests ?? 0,
        actualCalls: usage.calls ?? 0,
        successfulProofs: this.proofCost.successfulProofs,
        callsPerSuccessfulProof: this.proofCost.successfulProofs ? (usage.calls ?? 0) / this.proofCost.successfulProofs : undefined,
        cacheHits: draft.health.onchainRpc?.cacheHits ?? 0,
        coalescingHits: draft.health.onchainRpc?.coalescingHits ?? 0
      };
      draft.health.lastOnchainStateCycle = now.toISOString();
      draft.health.backfill = backfillHealth(draft, now);
      draft.health.providerRequestUsage = this.provider.usageSnapshot?.();
    }, (draft) => appendSemanticDeltas(draft, semanticBefore, touchedPoolKeys));
    return after;
  }

  async runEnrichmentLoop(signal) {
    return this.runLoop("provider", this.config.enrichmentIntervalMs, 45_000, (child) => this.runEnrichmentCycle(new Date(), child), signal);
  }

  async runEnrichmentCycle(now = new Date(), signal) {
    const before = this.store.read();
    const scheduled = structuredClone(before);
    if (hasEnrichmentSeedCandidate(scheduled, now)) seedEnrichmentQueue(scheduled, now);
    const due = selectFairEnrichmentBatch(
      (scheduled.enrichmentQueue ?? []).filter((item) => !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now.getTime()),
      before.pools,
      this.config.enrichmentBatchSize
    );
    if (!due.length) return before;
    const outcomes = await Promise.all(due.map(async (item) => {
      const pool = before.pools[item.poolKey];
      if (!pool?.poolAddress || pool.status !== "confirmed" || pool.orphaned) return { item, status: "discarded", reasonCode: "pool_no_longer_eligible" };
      try {
        const lookup = await this.provider.lookupPool(pool.poolAddress, { signal });
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
    throwIfAborted(signal);
    let semanticBefore;
    const after = await this.store.transact("bounded-pool-financial-enrichment", (draft) => {
      throwIfAborted(signal);
      semanticBefore = semanticSnapshot(draft, touchedPoolKeys);
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
            onchainState: pool.onchainState,
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
    }, (draft) => appendSemanticDeltas(draft, semanticBefore, touchedPoolKeys));
    return after;
  }

  async runAnchorLoop(signal) {
    return this.runLoop("anchor", this.config.anchorLoopIntervalMs ?? 5_000, this.config.anchorCycleTimeoutMs ?? 45_000, (child) => this.refreshAnchorIfDue(new Date(), child), signal);
  }

  async refreshAnchorIfDue(now = new Date(), signal) {
    const before = this.store.read();
    const current = before.priceAnchors?.wethUsdc;
    if (current?.nextRefreshAt && Date.parse(current.nextRefreshAt) > now.getTime()) return { loopSkipped: true };
    try {
      const trustedPoolAddresses = [...new Set([...(current?.candidates ?? []), ...(current?.lastTrustedCandidates ?? [])]
        .flatMap((candidate) => trustedAnchorPoolIdentity(current, candidate?.poolAddress) ? [candidate.poolAddress] : []))];
      const observations = selectAnchorValidationCandidates(await this.anchorProvider.lookupWethPools({ signal, poolAddresses: trustedPoolAddresses }));
      const lookupCompletedAt = new Date();
      const blockNumber = Math.max(1, (await this.anchorRpc.blockNumber({ signal })) - 2);
      const block = validBlock(await this.anchorRpc.getBlock(blockNumber, { signal }), blockNumber);
      block.observedAt = new Date(block.timestamp).toISOString();
      const exactOptions = { signal, blockProof: block };
      const metadata = { ...before.tokenMetadata };
      const anchorMetadataUpdates = {};
      for (const token of [BASE_WETH, BASE_USDC]) {
        if (!Number.isInteger(metadata[token]?.decimals)) {
          const exactDecimals = await readTokenDecimals(this.anchorRpc, token, blockNumber, exactOptions);
          metadata[token] = exactDecimals.ok
            ? { ...metadata[token], address: token, decimals: exactDecimals.decimals, codeExists: true, observedAt: exactDecimals.observedAt, blockNumber, status: metadata[token]?.name && metadata[token]?.symbol ? "complete" : "partial" }
            : metadata[token] ?? await enrichTokenMetadata(this.anchorRpc, token, blockNumber, now, exactOptions);
          anchorMetadataUpdates[token] = metadata[token];
        }
      }
      const inspected = await mapWithConcurrency(observations, 2, async (observation) => {
        let pool = trustedAnchorPoolIdentity(current, observation.poolAddress);
        if (!pool) {
          const identity = await inspectRegisteredPool(this.anchorRpc, observation.poolAddress, blockNumber, exactOptions);
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
        const onchainState = await readPoolOnchainState(this.anchorRpc, pool, metadata, block, exactOptions);
        if (onchainState.status !== "complete") throw new JsonRpcRequestError(onchainState.reasonCode, { method: onchainState.failureMethod, endpointLabel: onchainState.endpointLabel });
        const joined = joinExactProviderPools(pool, [observation], { onchainState, now: lookupCompletedAt });
        if (joined.status !== "matched") return undefined;
        const canonicalRate = pool.token0 === BASE_WETH ? onchainState.observedPrice0In1 : onchainState.observedPrice1In0;
        const amounts = onchainState.liquidityAmountsRaw;
        const amount0 = amounts ? Number(amounts.amount0Raw) / 10 ** onchainState.decimals0 : undefined;
        const amount1 = amounts ? Number(amounts.amount1Raw) / 10 ** onchainState.decimals1 : undefined;
        const liquidityUsd = amount0 * (pool.token0 === BASE_WETH ? canonicalRate : 1) + amount1 * (pool.token1 === BASE_WETH ? canonicalRate : 1);
        return {
          ...joined,
          onchainState,
          observedAt: onchainState.observedAt,
          liquidityUsd: Number.isFinite(liquidityUsd) ? liquidityUsd : undefined,
          token0: pool.token0,
          token1: pool.token1,
          registeredFactory: true,
          decimalsVerified: Number.isInteger(metadata[BASE_WETH]?.decimals) && Number.isInteger(metadata[BASE_USDC]?.decimals),
          factoryId: pool.factoryId,
          factoryAddress: pool.factoryAddress,
          protocolVersion: pool.protocolVersion,
          blockNumber,
          blockHash: block.hash,
          priceToken1PerToken0: canonicalRate,
          rawPriceRatio: pool.token0 === BASE_WETH ? onchainState.rawPriceRatio : invertRawRatio(onchainState.rawPriceRatio)
        };
      });
      const completedAt = new Date();
      const candidateAnchor = resolveWethUsdcAnchor(inspected.filter(Boolean), completedAt);
      const anchor = stabilizeWethUsdcAnchorRefresh(current, candidateAnchor, completedAt);
      throwIfAborted(signal);
      let semanticBefore;
      const after = await this.store.transact("trusted-weth-usdc-anchor-refresh", (draft) => {
        throwIfAborted(signal);
        semanticBefore = semanticSnapshot(draft, []);
        ensureEnrichmentState(draft);
        // Other metadata jobs may have committed while anchor RPC was in
        // flight. Only publish anchor-token fields actually read this cycle.
        for (const [token, update] of Object.entries(anchorMetadataUpdates)) {
          if (draft.tokenMetadata[token]?.verificationState !== "verified") draft.tokenMetadata[token] = { ...draft.tokenMetadata[token], ...update };
        }
        draft.priceAnchors.wethUsdc = anchor;
        if (anchor.status === "ready") draft.health.lastSuccessfulEnrichment = anchor.observedAt;
        draft.counters.staleAnchorRejected += anchor.rejected.filter((item) => item.reasonCode === "stale_anchor").length;
        draft.counters.dustRejected += anchor.rejected.filter((item) => item.reasonCode === "dust_anchor_liquidity").length;
        refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
      }, (draft) => appendSemanticDeltas(draft, semanticBefore, []));
      return after;
    } catch (error) {
      throwIfAborted(signal);
      await this.store.transact("trusted-anchor-refresh-failure", (draft) => {
        throwIfAborted(signal);
        ensureEnrichmentState(draft);
        const failedAt = new Date();
        const anchor = draft.priceAnchors.wethUsdc;
        const observed = Date.parse(anchor?.observedAt ?? "");
        if (!Number.isFinite(observed) || failedAt.getTime() - observed > 2 * 60_000) {
          draft.priceAnchors.wethUsdc = { ...anchor, status: "unavailable", reasonCode: error?.reasonCode ?? "anchor_provider_failure", freshness: "unavailable" };
        }
        draft.priceAnchors.wethUsdc.nextRefreshAt = new Date(failedAt.getTime() + 10_000).toISOString();
        draft.health.lastAnchorLoopFailure = safeError(error);
        draft.counters.enrichmentFailure += 1;
        refreshEnrichmentHealth(draft, this.provider.circuitSnapshot());
      });
      throw error;
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

function semanticSnapshot(state, poolKeys) {
  return { pools: Object.fromEntries(poolKeys.map((key) => [key, state.pools[key]])), priceAnchors: { ...state.priceAnchors }, opportunities: state.opportunities };
}

function appendSemanticDeltas(draft, before, touchedPoolKeys) {
  const events = [];
  for (const poolKey of new Set(touchedPoolKeys)) {
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
    if (previous && previous.canonicalPrice?.tier !== "UNPRICED" && opportunity.canonicalPrice.tier === "UNPRICED") events.push({ type: "opportunity_unpriced", data: { opportunityId: opportunity.id, reasonCode: opportunity.canonicalPrice.reasonCode } });
    if (previous && !previous.ranked && opportunity.ranked) events.push({ type: "opportunity_activated", data: { opportunityId: opportunity.id, tier: opportunity.canonicalPrice.tier } });
    if (previous && semanticObservedPrice(previous.observedPriceUsd) !== semanticObservedPrice(opportunity.observedPriceUsd)) events.push({ type: "opportunity_observed_price", data: { opportunityId: opportunity.id, value: opportunity.observedPriceUsd?.value, provider: opportunity.observedPriceUsd?.provider, poolAddress: opportunity.observedPriceUsd?.poolAddress, reasonCode: opportunity.observedPriceUsd?.reasonCode } });
    if (previous && (previous.liquidityState !== opportunity.liquidityState || previous.bestLiquidityUsd !== opportunity.bestLiquidityUsd)) events.push({ type: "opportunity_liquidity_resolved", data: { opportunityId: opportunity.id, liquidityState: opportunity.liquidityState, bestLiquidityUsd: opportunity.bestLiquidityUsd } });
    if (previous && previous.qualityBand !== opportunity.qualityBand) events.push({ type: "opportunity_band_changed", data: { opportunityId: opportunity.id, previousBand: previous.qualityBand, band: opportunity.qualityBand } });
    if (previous && !previous.ranked && opportunity.ranked) events.push({ type: "opportunity_ranked", data: { opportunityId: opportunity.id, band: opportunity.qualityBand } });
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
  const cursor = Math.min(...ENABLED.map((entry) => state.cursors?.[entry.id]?.blockNumber ?? 0));
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
    factories: Object.fromEntries(ENABLED.map((entry) => [entry.id, { enabled: true, healthy: (state.cursors?.[entry.id]?.blockNumber ?? 0) > 0, cursor: state.cursors?.[entry.id]?.blockNumber ?? 0 }])),
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
  state.proofCoverageCohort ??= { capturedAt: state.updatedAt ?? new Date().toISOString(), poolKeys: Object.keys(state.pools ?? {}).sort() };
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

export function seedMetadataQueue(state, now) {
  state.tokenMetadata ??= {};
  const queued = new Map((state.metadataQueue ?? []).map((item) => [item.tokenAddress, item]));
  const priorities = new Map();
  for (const pool of Object.values(state.pools ?? {})) {
    if (pool.status !== "confirmed" || pool.orphaned || pool.replay) continue;
    for (const token of [pool.token0, pool.token1].filter(Boolean)) priorities.set(token, Math.min(priorities.get(token) ?? Infinity, backfillPriority(pool, now)));
  }
  const jobs = [];
  for (const [token, priority] of priorities) {
    const metadata = state.tokenMetadata[token] ??= {};
    if (metadata.verificationState === "verified" || metadata.verificationState === "quarantined" || metadata.verificationState === "rejected" && metadata.retryable === false) continue;
    const previous = queued.get(token);
    const history = metadata.metadataBackfill ??= { attempts: previous?.attempts ?? 0, createdAt: previous?.createdAt ?? now.toISOString(), nextAttemptAt: metadata.retryAt ?? previous?.nextAttemptAt ?? now.toISOString() };
    if (Date.parse(history.nextAttemptAt) > now.getTime()) continue;
    const waitingSince = history.nextAttemptAt ?? history.createdAt;
    const score = priority - Math.floor(Math.max(0, now.getTime() - Date.parse(waitingSince)) / 60_000);
    jobs.push({ poolKey: token, tokenAddress: token, blockNumber: state.confirmedHead || state.currentHead, ...history, priority, score, waitingSince });
  }
  // Keep the best 256 pending prerequisites. Appending every missing token and
  // slicing the tail repeatedly evicted waiting jobs in address-order, starving
  // supported pools regardless of the pool-state scheduler's fairness.
  state.metadataQueue = jobs.sort((a, b) => a.score - b.score || Date.parse(a.waitingSince) - Date.parse(b.waitingSince) || a.tokenAddress.localeCompare(b.tokenAddress)).slice(0, 256);
}

function seedOnchainQueue(state, now) {
  seedBackfillQueue(state, now);
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
  if (containsAnchor) return 100;
  const supportedVerified = Boolean(resolveOnchainAdapter(pool)) && [pool.token0,pool.token1].every(token => validTokenDecimals(state.tokenMetadata?.[token]?.decimals) && state.tokenMetadata[token]?.verificationState === "verified");
  const value = Math.min(0.9, (Math.log1p(Math.max(0,pool.providerLiquidityUsd??0))+Math.log1p(Math.max(0,pool.volume24hUsd??0)))/100);
  if (pool.providerEnrichment?.status === "matched" && supportedVerified) return 99 + value;
  if ([pool.token0,pool.token1].includes(BASE_WETH)||[pool.token0,pool.token1].includes(BASE_USDC)) return 95 + value;
  if (pool.providerEnrichment?.status === "matched" && value > 0) return 90 + value;
  if (isRecentlyDetected(pool, now)) return 80;
  const opportunity = (state.opportunities ?? []).find((item) => item.poolKeys?.includes(pool.poolKey));
  if (pool.backfill?.lastSuccessfulHash) return 70 + value;
  if (pool.providerEnrichment?.status === "pending" || pool.onchainState?.status === "retryable") return 60;
  if (opportunity?.categoryEligibility?.new) return 55;
  if (opportunity?.qualityBand === "RANKED") return 50;
  if (opportunity?.qualityBand === "EMERGING") return 40;
  return 30;
}

export function selectFairEnrichmentBatch(queue, pools, maximum = 4) {
  const limit = Math.max(1, maximum);
  const discovery = [];
  const refresh = [];
  for (const item of queue ?? []) {
    if (pools?.[item.poolKey]?.providerEnrichment?.status === "matched") refresh.push(item);
    else discovery.push(item);
  }
  if (!discovery.length) return refresh.slice(0, limit);
  if (!refresh.length) return discovery.slice(0, limit);
  const refreshQuota = limit > 1 ? Math.max(1, Math.floor(limit / 4)) : 0;
  const discoveryCount = Math.min(discovery.length, limit - refreshQuota);
  const refreshCount = Math.min(refresh.length, limit - discoveryCount);
  const selected = [
    ...discovery.slice(0, discoveryCount),
    ...refresh.slice(0, refreshCount)
  ];
  if (selected.length < limit) selected.push(...discovery.slice(discoveryCount, discoveryCount + limit - selected.length));
  if (selected.length < limit) selected.push(...refresh.slice(refreshCount, refreshCount + limit - selected.length));
  return selected.slice(0, limit);
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
      results[index] = await operation(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function knownFactoryBinding(previous, event) {
  const immutableMatch = previous?.status === "confirmed" && !previous.replay && previous.blockHash === event.blockHash
    && ["factoryAddress", "token0", "token1", "poolKey", "blockNumber"].every((key) => previous[key] === event[key]);
  const proved = ["pool_contract", "factory_event_and_code", "factory_event_and_latest_code", "manager_pool_id", "manager_pool_id_latest_code"].includes(previous?.verifiedBinding);
  return immutableMatch && proved ? previous.verifiedBinding : undefined;
}

export async function verifyFactoryEvents(rpc, events, concurrency = 4, { signal, managerCodeEvidence, knownEvents } = {}) {
  if (typeof rpc?.batchOutcomes === "function") {
    const bindings = events.map((event) => {
      const kind = knownFactoryBinding(knownEvents?.[event.idempotencyKey], event);
      return kind ? { ok: true, kind } : undefined;
    });
    const fresh = await verifyPoolBindings(rpc, events.filter((_, index) => !bindings[index]), { signal, managerCodeEvidence });
    let freshIndex = 0;
    for (let index = 0; index < bindings.length; index += 1) if (!bindings[index]) bindings[index] = fresh[freshIndex++];
    // Reuse only the immutable factory binding. Every overlap block hash is
    // still re-read below, so a reorg cannot reuse an orphaned proof. This also
    // prevents a dense known overlap from exhausting every bounded scan tick.
    const unavailable = bindings.find((binding) => !binding.ok && binding.retryable);
    if (unavailable) throw new JsonRpcRequestError(unavailable.reason ?? "factory_binding_verification_unavailable", { method: "eth_getCode" });
    const accepted = events.flatMap((event, index) => bindings[index]?.ok ? [{ event, binding: bindings[index] }] : []);
    const blockNumbers = [...new Set(accepted.map(({ event }) => event.blockNumber))];
    const blockRows = new Map();
    for (let offset = 0; offset < blockNumbers.length; offset += PUBLIC_RPC_BLOCK_BATCH_CALL_LIMIT) {
      await rpc.paceBatch?.({ signal });
      const numbers = blockNumbers.slice(offset, offset + PUBLIC_RPC_BLOCK_BATCH_CALL_LIMIT);
      const outcomes = await rpc.batchOutcomes(numbers.map((blockNumber) => ({ method: "eth_getBlockByNumber", params: [`0x${blockNumber.toString(16)}`, false] })), { signal });
      const failure = outcomes.find((outcome) => !outcome.ok);
      if (failure) throw new JsonRpcRequestError(failure.reasonCode, failure);
      for (let index = 0; index < numbers.length; index += 1) blockRows.set(numbers[index], outcomes[index].value);
    }
    return accepted.map(({ event, binding }) => {
      const block = blockRows.get(event.blockNumber);
      if (block?.hash?.toLowerCase() !== event.blockHash?.toLowerCase()) throw new JsonRpcRequestError("rpc_block_hash_conflict", { retryable: false, method: "eth_getBlockByNumber" });
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
  const reason = error?.reasonCode ?? error?.message;
  return typeof reason === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(reason) ? reason : "collector_operation_failed";
}

function delay(milliseconds, signal) {
  if (signal?.aborted) return Promise.resolve();
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
