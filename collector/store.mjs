import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { getHeapStatistics } from "node:v8";
import { isMainThread, resourceLimits, threadId } from "node:worker_threads";
import { BASE_CHAIN_ID, COLLECTOR_VERSION, FACTORY_REGISTRY } from "./factory-registry.mjs";
import { JOURNAL_VERSION, createJournalCursor, journalDigest, journalPayload, replayJournalChunk, stableSha256, validatePatch } from "./journal.mjs";
import { buildCanonicalOpportunities, MAX_EVENT_RING, MAX_HISTORY_RING, MAX_PRICE_AGE_MS, MAX_RECONCILIATION_RING } from "./model.mjs";
import { calculateProofFunnel } from "./proof-coverage.mjs";
import { resolveOnchainPoolEvidence } from "./onchain-state.mjs";

export const STORE_SCHEMA_VERSION = 1;
export const MAX_CANONICAL_EVENTS = 5_000;
export const MAX_POOLS = 2_000;
export const MAX_PROTECTED_PROVIDER_POOLS = 512;
export const MAX_MARKET_SNAPSHOTS = 96;
export const MAX_WAL_LINES = 512;
export const PROOF_COHORT_RETENTION_MS = 6 * 60 * 60 * 1_000;
export const MAX_OPPORTUNITIES = 2_000;
export const MAX_RECORD_BYTES = 512 * 1_024;
export const MAX_OPPORTUNITIES_BYTES = 16 * 1_024 * 1_024;
export const MAX_DELTA_BYTES = 24 * 1_024 * 1_024;
export const MAX_WAL_BYTES = 64 * 1_024 * 1_024;
export const MAX_CHECKPOINT_BYTES = 64 * 1_024 * 1_024;
export const DEFAULT_CHECKPOINT_INTERVAL_MS = 15 * 60_000;
export const DEFAULT_CHECKPOINT_TRANSACTION_LIMIT = 256;
export const DEFAULT_MAX_PENDING_TRANSACTIONS = 24;
export const STORE_LIMITS = Object.freeze({
  pools: MAX_POOLS,
  canonicalEvents: MAX_CANONICAL_EVENTS,
  opportunities: MAX_OPPORTUNITIES,
  metadataQueue: 256,
  onchainQueue: 512,
  enrichmentQueue: 512,
  history: MAX_HISTORY_RING,
  reconciliation: MAX_RECONCILIATION_RING,
  relayEvents: MAX_EVENT_RING,
  marketSnapshots: MAX_MARKET_SNAPSHOTS,
  recordBytes: MAX_RECORD_BYTES,
  opportunitiesBytes: MAX_OPPORTUNITIES_BYTES,
  deltaBytes: MAX_DELTA_BYTES,
  walBytes: MAX_WAL_BYTES,
  checkpointBytes: MAX_CHECKPOINT_BYTES
});

export class DurableDiscoveryStore {
  constructor(directory, options = {}) {
    this.directory = path.resolve(directory);
    this.statePath = path.join(this.directory, "state.json");
    this.walPath = path.join(this.directory, "wal.ndjson");
    this.lockPath = path.join(this.directory, "collector.lock");
    this.now = options.now ?? (() => new Date());
    this.checkpointIntervalMs = boundedOption(options.checkpointIntervalMs, DEFAULT_CHECKPOINT_INTERVAL_MS, 1_000, 24 * 60 * 60_000);
    this.checkpointTransactionLimit = boundedOption(options.checkpointTransactionLimit, DEFAULT_CHECKPOINT_TRANSACTION_LIMIT, 1, 4_096);
    this.maxPendingTransactions = boundedOption(options.maxPendingTransactions, DEFAULT_MAX_PENDING_TRANSACTIONS, 1, 256);
    this.metricsLogger = options.metricsLogger === undefined ? console.info : options.metricsLogger;
    this.metricsLogIntervalMs = boundedOption(options.metricsLogIntervalMs, 60_000, 10_000, 60 * 60_000);
    this.faultInjector = options.faultInjector;
    this.state = undefined;
    this.lockHandle = undefined;
    this.closed = false;
    this.transactionTail = Promise.resolve();
    this.pendingTransactions = 0;
    this.transactionSlotWaiters = [];
    this.runtimeHealth = {};
    this.sequence = 0;
    this.journalChainDigest = undefined;
    this.lastCheckpointAtMs = 0;
    this.transactionsSinceCheckpoint = 0;
    this.walBytes = 0;
    this.stateBytesEstimate = 0;
    this.checkpointScheduled = false;
    this.metrics = initialStoreMetrics();
    this.sampleResources("constructed");
  }

  async open({ returnView = false } = {}) {
    await mkdir(this.directory, { recursive: true, mode: 0o750 });
    await this.acquireLock();
    try {
      this.sampleResources("open_before_load");
      this.state = await this.loadOrInitialize();
      this.sampleResources("open_after_parse", { stateBytes: this.stateBytesEstimate });
      const cursor = createJournalCursor(this.state);
      let journal = Buffer.alloc(0);
      try { journal = await readFile(this.walPath); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      const recoveryStarted = process.hrtime.bigint();
      const recovery = replayJournalChunk(cursor, journal);
      if (recovery.incompleteBytes > 0) await truncateDurably(this.walPath, recovery.consumedBytes);
      this.state = cursor.state;
      this.sequence = cursor.sequence;
      this.journalChainDigest = cursor.digest;
      this.walBytes = recovery.consumedBytes;
      this.transactionsSinceCheckpoint = recovery.applied;
      this.lastCheckpointAtMs = Date.parse(this.state.persistence?.checkpointAt ?? "");
      if (!Number.isFinite(this.lastCheckpointAtMs)) this.lastCheckpointAtMs = this.now().getTime();
      this.metrics.recoveryCount += 1;
      this.metrics.recoveredTransactions += recovery.applied;
      this.metrics.recoveryMs += elapsedMs(recoveryStarted);
      this.metrics.tornTailBytes += recovery.incompleteBytes;
      this.sampleResources("open_after_recovery", { stateBytes: this.stateBytesEstimate, messageBytes: recovery.consumedBytes });
      return returnView ? this.readView() : this.read();
    } catch (error) {
      await this.releaseLock();
      throw error;
    }
  }

  read() {
    const view = this.readView();
    this.metrics.structuredCloneCalls += 1;
    this.metrics.maxCloneSourceBytes = Math.max(this.metrics.maxCloneSourceBytes, this.stateBytesEstimate);
    this.sampleResources("snapshot_clone_before", { stateBytes: this.stateBytesEstimate, messageBytes: this.stateBytesEstimate });
    const snapshot = structuredClone(view);
    this.sampleResources("snapshot_clone_after", { stateBytes: this.stateBytesEstimate, messageBytes: this.stateBytesEstimate });
    return snapshot;
  }

  readView() {
    if (!this.state) throw new Error("Store is not open");
    if (!Object.keys(this.runtimeHealth).length) return this.state;
    return { ...this.state, health: mergeHealth(this.state.health, this.runtimeHealth) };
  }

  async transact(reason, mutator, afterDerive, options = {}) {
    if (this.closed) throw new Error("Store is not writable");
    if (this.pendingTransactions >= this.maxPendingTransactions) {
      this.metrics.backpressureWaits += 1;
      await new Promise((resolve) => this.transactionSlotWaiters.push(resolve));
    }
    if (this.closed) {
      this.releaseTransactionSlot();
      throw new Error("Store is not writable");
    }
    this.pendingTransactions += 1;
    this.metrics.queuePeak = Math.max(this.metrics.queuePeak, this.pendingTransactions);
    const queuedAt = process.hrtime.bigint();
    const operation = this.transactionTail.then(() => {
      this.metrics.queueWaitMs += elapsedMs(queuedAt);
      return this.performTransaction(reason, mutator, afterDerive, options);
    });
    this.transactionTail = operation.catch(() => {});
    try {
      const state = await operation;
      return options.returnView ? state : this.read();
    }
    finally {
      this.pendingTransactions -= 1;
      this.releaseTransactionSlot();
    }
  }

  transactView(reason, mutator, afterDerive, options = {}) {
    return this.transact(reason, mutator, afterDerive, { ...options, returnView: true });
  }

  async updateRuntimeStatus(reason, update) {
    if (!this.state || this.closed) throw new Error("Store is not writable");
    const started = process.hrtime.bigint();
    const current = structuredClone(this.runtimeHealth);
    const result = typeof update === "function" ? await update(current) : update;
    const next = result && typeof result === "object" ? result : current;
    this.runtimeHealth = mergeHealth(this.runtimeHealth, structuredClone(next));
    this.metrics.statusOnlyUpdates += 1;
    this.metrics.statusOnlyMs += elapsedMs(started);
    this.recordReason(reason, { kind: "status", logicalBytes: Buffer.byteLength(JSON.stringify(next) ?? "", "utf8") });
    this.maybeLogMetrics();
    return structuredClone(this.runtimeHealth);
  }

  async performTransaction(reason, mutator, afterDerive, { derive = true } = {}) {
    if (!this.state || this.closed) throw new Error("Store is not writable");
    if (typeof reason !== "string" || !reason || reason.length > 160) throw new Error("Store transaction reason is invalid");
    const started = process.hrtime.bigint();
    const cpuStarted = process.cpuUsage();
    const transactionId = randomUUID();
    this.metrics.structuredCloneCalls += 1;
    this.metrics.maxCloneSourceBytes = Math.max(this.metrics.maxCloneSourceBytes, this.stateBytesEstimate);
    this.sampleResources("transaction_before_draft", { stateBytes: this.stateBytesEstimate, messageBytes: this.stateBytesEstimate });
    const tracked = createTrackedDraft(this.state);
    this.sampleResources("transaction_after_draft", { stateBytes: this.stateBytesEstimate, messageBytes: this.stateBytesEstimate });
    const next = tracked.proxy;
    const result = await mutator(next);
    this.sampleResources("transaction_after_mutation", { stateBytes: this.stateBytesEstimate });
    if (result && result !== next && result !== tracked.raw) throw new Error("store_mutator_replacement_unsupported");
    if (!tracked.changed.size) {
      this.metrics.noOpTransactions += 1;
      this.recordReason(reason, { kind: "noop", durationMs: elapsedMs(started) });
      this.maybeLogMetrics();
      tracked.release();
      return this.readView();
    }
    if (Object.keys(this.runtimeHealth).length) next.health = mergeHealth(next.health, this.runtimeHealth);
    next.schemaVersion = STORE_SCHEMA_VERSION;
    next.collectorVersion = COLLECTOR_VERSION;
    next.updatedAt = this.now().toISOString();
    enforceRetention(next);
    expireStalePriceAnchors(next, new Date(next.updatedAt));
    next.health.loops ??= {};
    if (derive) {
      // Derived pricing has no remote I/O and cannot roll back durable ingestion
      // on failure. A failed derivation preserves the last-good opportunities,
      // marks them unavailable for freshness, and retries on the next commit.
      const previousPools = this.state.pools;
      const previousOpportunities = this.state.opportunities;
      try {
        resolveOnchainPoolEvidence(next, new Date(next.updatedAt));
        next.opportunities = buildCanonicalOpportunities(pricingPoolsForState(next), next.tokenMetadata ?? {}, next.opportunities ?? [], new Date(next.updatedAt)).slice(0, MAX_OPPORTUNITIES);
        const previousError = next.health.loops.opportunities?.lastError;
        next.health.loops.opportunities = { phase: "idle", lastSuccessAt: next.updatedAt, lastError: previousError ? { ...previousError, recoveredAt: previousError.recoveredAt ?? next.updatedAt } : undefined };
      } catch {
        next.pools = previousPools;
        next.opportunities = previousOpportunities;
        next.health.loops.opportunities = { ...this.state.health.loops?.opportunities, phase: "retrying", lastError: { reasonCode: "opportunity_rebuild_failed", observedAt: next.updatedAt, retryAt: new Date(Date.parse(next.updatedAt) + 10_000).toISOString() } };
      }
    }
    next.health.loops.publish = { phase: "idle", lastSuccessAt: next.updatedAt };
    synchronizeDerivedHealth(next);
    if (afterDerive) await afterDerive(next);
    enforceRetention(next);
    const patch = tracked.buildPatch();
    tracked.release();
    this.sampleResources("transaction_after_patch", { stateBytes: this.stateBytesEstimate });
    validatePatch(patch);
    validateStateLimits(tracked.raw, patch);
    const sequence = this.sequence + 1;
    const beforeDigest = this.journalChainDigest;
    const prepare = { journalVersion: JOURNAL_VERSION, type: "prepare", transactionId, sequence, at: tracked.raw.updatedAt, reason, beforeDigest, patch };
    prepare.afterDigest = journalDigest(beforeDigest, journalPayload(prepare));
    const prepareBytes = serializedLineBytes(prepare);
    const commit = { journalVersion: JOURNAL_VERSION, type: "commit", transactionId, sequence, at: tracked.raw.updatedAt, afterDigest: prepare.afterDigest };
    const commitBytes = serializedLineBytes(commit);
    this.metrics.maxJournalMessageBytes = Math.max(this.metrics.maxJournalMessageBytes, prepareBytes, commitBytes);
    if (prepareBytes > MAX_DELTA_BYTES || this.walBytes + prepareBytes + commitBytes > MAX_WAL_BYTES) throw new Error("store_journal_limit_exceeded");

    await this.injectFault("before-journal-prepare", { reason, sequence });
    await appendDurableLine(this.walPath, prepare);
    await this.injectFault("after-journal-prepare", { reason, sequence });
    await appendDurableLine(this.walPath, commit);
    await this.injectFault("after-journal-commit", { reason, sequence });
    this.sampleResources("transaction_after_journal", { stateBytes: this.stateBytesEstimate, messageBytes: prepareBytes });

    this.state = tracked.raw;
    this.sequence = sequence;
    this.journalChainDigest = prepare.afterDigest;
    this.transactionsSinceCheckpoint += 1;
    this.walBytes += prepareBytes + commitBytes;
    this.metrics.transactions += 1;
    this.metrics.logicalDeltaBytes += prepareBytes;
    this.metrics.journalBytes += prepareBytes + commitBytes;
    const cpu = process.cpuUsage(cpuStarted);
    this.metrics.cpuMicros += cpu.user + cpu.system;
    const durationMs = elapsedMs(started);
    this.metrics.transactionMs += durationMs;
    this.recordReason(reason, { kind: "delta", durationMs, logicalBytes: prepareBytes, physicalBytes: prepareBytes + commitBytes, patchOperations: patch.length });
    this.maybeCheckpoint();
    this.maybeLogMetrics();
    this.sampleResources("transaction_complete", { stateBytes: this.stateBytesEstimate, messageBytes: prepareBytes });
    return this.readView();
  }

  integrityCheck() {
    if (!this.state) return { ok: false, reason: "store_not_open" };
    const expected = createIntegrity(this.state);
    return { ok: true, schemaVersion: this.state.schemaVersion, digest: expected.digest, checkpointDigest: this.state.integrity?.digest, journalDigest: this.journalChainDigest, sequence: this.sequence };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.flush();
      await this.checkpoint();
    } finally {
      await this.releaseLock();
    }
  }

  getMetrics() {
    return structuredClone({ ...this.metrics, queueDepth: this.pendingTransactions, walBytes: this.walBytes, sequence: this.sequence, transactionsSinceCheckpoint: this.transactionsSinceCheckpoint, limits: STORE_LIMITS });
  }

  async flush() {
    let observed;
    do {
      observed = this.transactionTail;
      await observed.catch(() => {});
    } while (observed !== this.transactionTail);
  }

  maybeCheckpoint() {
    const dueByAge = this.now().getTime() - this.lastCheckpointAtMs >= this.checkpointIntervalMs;
    const dueByCount = this.transactionsSinceCheckpoint >= this.checkpointTransactionLimit;
    const dueByWal = this.walBytes >= Math.floor(MAX_WAL_BYTES * 0.75);
    if (!dueByAge && !dueByCount && !dueByWal) return false;
    this.scheduleCheckpoint();
    return true;
  }

  scheduleCheckpoint() {
    if (this.checkpointScheduled || this.closed) return false;
    this.checkpointScheduled = true;
    const checkpoint = this.transactionTail.then(() => this.checkpoint()).catch((error) => {
      this.metrics.checkpointFailures += 1;
      this.metrics.lastCheckpointError = safeFailure(error);
      this.logMetric({ event: "collector_checkpoint_failure", reasonCode: safeFailure(error), sequence: this.sequence });
    }).finally(() => { this.checkpointScheduled = false; });
    this.transactionTail = checkpoint.catch(() => {});
    return true;
  }

  async checkpoint() {
    if (!this.state || this.transactionsSinceCheckpoint === 0) return false;
    const started = process.hrtime.bigint();
    const cpuStarted = process.cpuUsage();
    this.sampleResources("checkpoint_start", { stateBytes: this.stateBytesEstimate });
    const checkpointed = { ...this.state };
    const checkpointAt = this.now().toISOString();
    checkpointed.persistence = { journalVersion: JOURNAL_VERSION, appliedSequence: this.sequence, journalDigest: this.journalChainDigest, checkpointAt };
    const integrityStarted = process.hrtime.bigint();
    checkpointed.integrity = createIntegrity(checkpointed);
    this.metrics.checkpointIntegrityMs += elapsedMs(integrityStarted);
    this.sampleResources("checkpoint_after_integrity", { stateBytes: this.stateBytesEstimate });
    const serializationStarted = process.hrtime.bigint();
    const serialized = `${JSON.stringify(checkpointed, null, 2)}\n`;
    const bytes = Buffer.byteLength(serialized, "utf8");
    this.metrics.checkpointSerializeMs += elapsedMs(serializationStarted);
    this.metrics.maxCheckpointMessageBytes = Math.max(this.metrics.maxCheckpointMessageBytes, bytes);
    this.sampleResources("checkpoint_after_serialize", { stateBytes: bytes, messageBytes: bytes });
    if (bytes > MAX_CHECKPOINT_BYTES) throw new Error("store_checkpoint_limit_exceeded");
    await this.injectFault("before-checkpoint-write", { sequence: this.sequence });
    const writeStarted = process.hrtime.bigint();
    const writeCpuStarted = process.cpuUsage();
    await writeAtomicText(this.statePath, serialized, (stage) => this.injectFault(stage, { sequence: this.sequence }));
    const writeCpu = process.cpuUsage(writeCpuStarted);
    const writeMs = elapsedMs(writeStarted);
    const writeCpuMs = (writeCpu.user + writeCpu.system) / 1_000;
    this.metrics.checkpointWriteMs += writeMs;
    this.metrics.checkpointWriteCpuMs += writeCpuMs;
    this.metrics.checkpointDiskWaitMs += Math.max(0, writeMs - writeCpuMs);
    this.state = checkpointed;
    this.stateBytesEstimate = bytes;
    this.lastCheckpointAtMs = Date.parse(checkpointAt);
    this.transactionsSinceCheckpoint = 0;
    this.metrics.checkpoints += 1;
    this.metrics.checkpointBytes += bytes;
    this.metrics.checkpointMs += elapsedMs(started);
    const cpu = process.cpuUsage(cpuStarted);
    this.metrics.checkpointCpuMs += (cpu.user + cpu.system) / 1_000;
    this.sampleResources("checkpoint_after_write", { stateBytes: bytes, messageBytes: bytes });
    try {
      await writeAtomicText(this.walPath, "", (stage) => this.injectFault(`wal-${stage}`, { sequence: this.sequence }));
      this.walBytes = 0;
    } catch (error) {
      this.logMetric({ event: "collector_wal_compaction_deferred", reasonCode: safeFailure(error), sequence: this.sequence });
    }
    this.sampleResources("checkpoint_complete", { stateBytes: bytes });
    return true;
  }

  sampleResources(phase, { stateBytes = 0, messageBytes = 0 } = {}) {
    const memory = process.memoryUsage();
    const cgroupMemory = readCgroupMemoryCurrent();
    const sample = {
      heapUsed: memory.heapUsed,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
      rss: memory.rss,
      cgroupMemory,
      stateBytes,
      messageBytes,
      pendingTransactions: this.pendingTransactions,
      transactionWaiters: this.transactionSlotWaiters.length,
      onchainQueueDepth: this.state?.onchainQueue?.length ?? 0,
      enrichmentQueueDepth: this.state?.enrichmentQueue?.length ?? 0
    };
    this.metrics.resourceSamples += 1;
    this.metrics.peakHeapUsed = Math.max(this.metrics.peakHeapUsed, sample.heapUsed);
    this.metrics.peakExternal = Math.max(this.metrics.peakExternal, sample.external);
    this.metrics.peakArrayBuffers = Math.max(this.metrics.peakArrayBuffers, sample.arrayBuffers);
    this.metrics.peakRss = Math.max(this.metrics.peakRss, sample.rss);
    this.metrics.peakCgroupMemory = Math.max(this.metrics.peakCgroupMemory, sample.cgroupMemory ?? 0);
    this.metrics.maxObservedStateBytes = Math.max(this.metrics.maxObservedStateBytes, stateBytes);
    this.metrics.maxObservedMessageBytes = Math.max(this.metrics.maxObservedMessageBytes, messageBytes);
    const previous = this.metrics.resourcePhases[phase];
    this.metrics.resourcePhases[phase] = previous ? {
      samples: previous.samples + 1,
      peakHeapUsed: Math.max(previous.peakHeapUsed, sample.heapUsed),
      peakRss: Math.max(previous.peakRss, sample.rss),
      peakCgroupMemory: Math.max(previous.peakCgroupMemory ?? 0, sample.cgroupMemory ?? 0),
      maxMessageBytes: Math.max(previous.maxMessageBytes, messageBytes)
    } : { samples: 1, peakHeapUsed: sample.heapUsed, peakRss: sample.rss, peakCgroupMemory: sample.cgroupMemory, maxMessageBytes: messageBytes };
    return sample;
  }

  recordReason(reason, sample) {
    const current = this.metrics.reasons[reason] ?? { count: 0, logicalBytes: 0, physicalBytes: 0, durationMs: 0, patchOperations: 0, kinds: {} };
    current.count += 1;
    current.logicalBytes += sample.logicalBytes ?? 0;
    current.physicalBytes += sample.physicalBytes ?? 0;
    current.durationMs += sample.durationMs ?? 0;
    current.patchOperations += sample.patchOperations ?? 0;
    current.kinds[sample.kind] = (current.kinds[sample.kind] ?? 0) + 1;
    this.metrics.reasons[reason] = current;
    const entries = Object.entries(this.metrics.reasons);
    if (entries.length > 32) delete this.metrics.reasons[entries.sort((a, b) => a[1].count - b[1].count || a[0].localeCompare(b[0]))[0][0]];
  }

  maybeLogMetrics() {
    const nowMs = this.now().getTime();
    if (nowMs - this.metrics.lastLogAtMs < this.metricsLogIntervalMs) return;
    this.metrics.lastLogAtMs = nowMs;
    this.logMetric({ event: "collector_store_metrics", ...this.getMetrics() });
  }

  logMetric(value) {
    if (typeof this.metricsLogger !== "function") return;
    const serialized = JSON.stringify(value);
    this.metricsLogger(serialized.length <= 16_384 ? serialized : JSON.stringify({ event: value.event, reasonCode: "metric_payload_bounded", sequence: this.sequence }));
  }

  async injectFault(stage, context) {
    if (typeof this.faultInjector === "function") await this.faultInjector(stage, context);
  }

  releaseTransactionSlot() {
    const next = this.transactionSlotWaiters.shift();
    if (next) next();
  }

  async loadOrInitialize() {
    try {
      const raw = await readFile(this.statePath, "utf8");
      this.stateBytesEstimate = Buffer.byteLength(raw, "utf8");
      const parsed = migrate(JSON.parse(raw));
      const expected = createIntegrity(parsed);
      if (parsed.integrity?.digest !== expected.digest) throw new Error("Store integrity digest mismatch");
      return parsed;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const state = initialState();
      this.stateBytesEstimate = await writeAtomicJson(this.statePath, state);
      return state;
    }
  }

  async acquireLock() {
    try {
      this.lockHandle = await open(this.lockPath, "wx", 0o640);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const stale = await readStaleLock(this.lockPath);
      if (!stale) throw new Error("Collector store already has an active owner");
      await rm(this.lockPath, { force: true });
      this.lockHandle = await open(this.lockPath, "wx", 0o640);
    }
    await this.lockHandle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`, "utf8");
    await this.lockHandle.sync();
  }

  async releaseLock() {
    if (!this.lockHandle) return;
    try { await this.lockHandle.close(); } catch { /* best effort during shutdown */ }
    this.lockHandle = undefined;
    await rm(this.lockPath, { force: true });
  }

}

export function initialState(now = new Date()) {
  const timestamp = now.toISOString();
  const state = {
    schemaVersion: STORE_SCHEMA_VERSION,
    collectorVersion: COLLECTOR_VERSION,
    chainId: BASE_CHAIN_ID,
    createdAt: timestamp,
    updatedAt: timestamp,
    mode: "confirmed_polling",
    currentHead: 0,
    confirmedHead: 0,
    cursors: Object.fromEntries(FACTORY_REGISTRY.filter((entry) => entry.enabled).map((entry) => [entry.id, { blockNumber: 0, blockHash: undefined, updatedAt: timestamp }])),
    events: {},
    pools: {},
    tokenMetadata: {},
    opportunities: [],
    priceAnchors: { wethUsdc: { status: "unavailable", reasonCode: "not_initialized", sourcePoolCount: 0, freshness: "unavailable" } },
    marketSnapshots: [],
    history: [],
    reconciliation: [],
    eventRing: [],
    nextEventSequence: 0,
    provisional: {},
    metadataQueue: [],
    onchainQueue: [],
    enrichmentQueue: [],
    counters: { reconnectCount: 0, reorgCount: 0, duplicateDropped: 0, malformedRejected: 0, enrichmentSuccess: 0, enrichmentFailure: 0, providerMatched: 0, providerUnmatched: 0, priceConflict: 0, staleAnchorRejected: 0, dustRejected: 0, exactLookupSuccess: 0, exactLookupPending: 0, exactLookupNotFound: 0, bandTransitions: 0, onchainStateSuccess: 0, onchainStateFailure: 0, onchainStateClassified: 0, onchainStateDuplicate: 0, onchainStateOutOfOrder: 0, tokenMetadataVerified: 0 },
    health: {
      ready: false,
      mode: "confirmed_polling",
      backfillState: "initializing",
      lastEventTime: undefined,
      lastConfirmedEvent: undefined,
      lagBlocks: undefined,
      lagSeconds: undefined,
      factories: Object.fromEntries(FACTORY_REGISTRY.map((entry) => [entry.id, { enabled: entry.enabled, healthy: false, cursor: 0 }])),
      storeIntegrity: "initializing",
      enrichmentQueueDepth: 0,
      onchainQueueDepth: 0,
      anchorStatus: "unavailable"
    },
    integrity: { algorithm: "sha256", digest: "" }
  };
  state.integrity = createIntegrity(state);
  return state;
}

export function createIntegrity(state) {
  const clone = { ...state };
  delete clone.integrity;
  return { algorithm: "sha256", digest: stableSha256(clone) };
}

export function readStoreSnapshotSync(directory) {
  try {
    const root = path.resolve(directory);
    const file = path.join(root, "state.json");
    const state = migrate(JSON.parse(readFileSync(file, "utf8")));
    const expected = createIntegrity(state);
    if (state.integrity?.digest !== expected.digest) return { ok: false, reason: "digest_mismatch" };
    const cursor = createJournalCursor(state);
    try { replayJournalChunk(cursor, readFileSync(path.join(root, "wal.ndjson"))); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    return { ok: true, state: cursor.state };
  } catch (error) {
    return { ok: false, reason: error?.code === "ENOENT" ? "store_unavailable" : "store_invalid" };
  }
}

function migrate(state) {
  if (state?.schemaVersion === STORE_SCHEMA_VERSION) return state;
  throw new Error(`Unsupported store schema: ${state?.schemaVersion ?? "missing"}`);
}

function enforceRetention(state) {
  trimTail(state, "history", MAX_HISTORY_RING);
  trimTail(state, "reconciliation", MAX_RECONCILIATION_RING);
  trimTail(state, "eventRing", MAX_EVENT_RING);
  trimTail(state, "marketSnapshots", MAX_MARKET_SNAPSHOTS);
  trimTail(state, "metadataQueue", 256);
  trimHead(state, "onchainQueue", 512);
  trimHead(state, "enrichmentQueue", 512);
  trimHead(state, "opportunities", MAX_OPPORTUNITIES);
  if (Object.keys(state.events ?? {}).length > MAX_CANONICAL_EVENTS) state.events = keepNewestRecordEntries(state.events ?? {}, MAX_CANONICAL_EVENTS, (event) => event.blockNumber ?? 0);
  const previousPools = state.pools ?? {};
  const cohortExpiresAt = Date.parse(state.proofCoverageCohort?.expiresAt ?? "");
  const protectedCohort = Number.isFinite(cohortExpiresAt) && Date.parse(state.updatedAt) <= cohortExpiresAt
    ? new Set(state.proofCoverageCohort.poolKeys ?? [])
    : new Set();
  if (Object.keys(previousPools).length > MAX_POOLS) state.pools = retainPriorityPools(previousPools, MAX_POOLS, MAX_PROTECTED_PROVIDER_POOLS, protectedCohort);
  const evicted = Object.keys(previousPools).filter((key) => !state.pools[key]);
  if (evicted.length) {
    state.counters.retentionEvicted = (state.counters.retentionEvicted ?? 0) + evicted.length;
    state.reconciliation.push(...evicted.map((poolKey) => ({ kind: "retention_eviction", poolKey, blockNumber: previousPools[poolKey].blockNumber, reasonCode: "bounded_universe_oldest_unprotected", at: state.updatedAt })));
    state.reconciliation = state.reconciliation.slice(-MAX_RECONCILIATION_RING);
  }
  const retainedTokens = new Set(Object.values(state.pools).flatMap((pool) => [pool.token0, pool.token1]));
  const metadataEntries = Object.entries(state.tokenMetadata ?? {});
  if (metadataEntries.some(([address]) => !retainedTokens.has(address))) state.tokenMetadata = Object.fromEntries(metadataEntries.filter(([address]) => retainedTokens.has(address)));
}

export function pricingPoolsForState(state) {
  const pools = Object.values(state.pools ?? {});
  const anchor = state.priceAnchors?.wethUsdc;
  return anchor?.status === "ready" && anchor.pricingPool ? [...pools, anchor.pricingPool] : pools;
}

export function expireStalePriceAnchors(state, now = new Date()) {
  const anchor = state.priceAnchors?.wethUsdc;
  if (anchor?.status !== "ready") return state;
  const observedMs = Date.parse(anchor.observedAt ?? "");
  const ageMs = now.getTime() - observedMs;
  if (Number.isFinite(observedMs) && ageMs >= 0 && ageMs <= MAX_PRICE_AGE_MS) return state;
  state.priceAnchors.wethUsdc = {
    ...anchor,
    status: "unavailable",
    freshness: "unavailable",
    reasonCode: Number.isFinite(observedMs) && ageMs > MAX_PRICE_AGE_MS ? "stale_anchor" : "invalid_anchor_timestamp",
    nextRefreshAt: now.toISOString()
  };
  return state;
}

function synchronizeDerivedHealth(state) {
  state.health ??= {};
  const cursors = Object.values(state.cursors ?? {}).map((row) => row.blockNumber);
  const cursor = cursors.length ? Math.min(...cursors) : 0;
  const lag = Math.max(0, (state.confirmedHead ?? 0) - cursor);
  state.health.confirmedCursor = cursor;
  state.health.lagBlocks = lag;
  state.health.lagSeconds = lag * 2;
  const headAgeMs = Date.parse(state.updatedAt) - Date.parse(state.health.lastHeadObservedAt ?? "");
  // Legacy snapshots without head timestamps retain their old readiness until
  // reconciliation; HTTP readers still reject their stale cursor timestamp.
  if (state.health.lastHeadObservedAt) {
    state.health.ready = cursor > 0 && lag <= 16 && Number.isFinite(headAgeMs) && headAgeMs <= 45_000;
    state.health.delayedReason = headAgeMs > 45_000 ? "head_observation_stale" : lag > 16 ? "confirmed_cursor_behind" : undefined;
    state.health.backfillState = lag === 0 ? "caught_up" : "catching_up";
  }
  if (state.health.loops?.opportunities?.phase === "retrying") { state.health.ready = false; state.health.delayedReason = "opportunity_rebuild_failed"; }
  const pricingTierCounts = { A: 0, B: 0, C: 0, UNPRICED: 0 };
  for (const opportunity of state.opportunities ?? []) {
    const tier = opportunity.canonicalPrice?.tier;
    pricingTierCounts[tier === "A" || tier === "B" || tier === "C" ? tier : "UNPRICED"] += 1;
  }
  const anchor = state.priceAnchors?.wethUsdc ?? {};
  state.health.pricingTierCounts = pricingTierCounts;
  state.health.pricedOpportunities = pricingTierCounts.A + pricingTierCounts.B + pricingTierCounts.C;
  state.health.rankedOpportunities = (state.opportunities ?? []).filter((opportunity) => opportunity.ranked).length;
  const bands = { RANKED: 0, EMERGING: 0, DETECTED: 0, REJECTED: 0 };
  const liquidity = { liquidity_unknown: 0, thin_liquidity: 0, zero_liquidity: 0, usable_liquidity: 0, conflicting_liquidity: 0, stale_liquidity: 0 };
  for (const opportunity of state.opportunities ?? []) {
    if (Object.hasOwn(bands, opportunity.qualityBand)) bands[opportunity.qualityBand] += 1;
    if (Object.hasOwn(liquidity, opportunity.liquidityState)) liquidity[opportunity.liquidityState] += 1;
  }
  state.health.rankedCount = bands.RANKED;
  state.health.emergingCount = bands.EMERGING;
  state.health.detectedCount = bands.DETECTED;
  state.health.rejectedConflictingCount = bands.REJECTED + Object.values(state.pools ?? {}).filter((pool) => pool.providerEnrichment?.status === "conflicting").length;
  state.health.observedPriceCount = (state.opportunities ?? []).filter((opportunity) => Number.isFinite(opportunity.observedPriceUsd?.value) && opportunity.observedPriceUsd.value > 0).length;
  state.health.canonicalPriceCount = pricingTierCounts.A + pricingTierCounts.B + pricingTierCounts.C;
  state.health.liquidityUnknownCount = liquidity.liquidity_unknown;
  state.health.thinLiquidityCount = liquidity.thin_liquidity;
  state.health.zeroLiquidityCount = liquidity.zero_liquidity;
  state.health.usableLiquidityCount = liquidity.usable_liquidity;
  state.health.conflictingLiquidityCount = liquidity.conflicting_liquidity;
  state.health.staleLiquidityCount = liquidity.stale_liquidity;
  state.health.anchorStatus = anchor.status ?? "unavailable";
  state.health.anchorUsdPrice = anchor.value;
  state.health.anchorSourcePoolCount = anchor.sourcePoolCount ?? 0;
  state.health.anchorObservedAt = anchor.observedAt;
  state.health.anchorFreshness = anchor.freshness ?? "unavailable";
  state.health.anchorReasonCode = anchor.reasonCode;
  state.health.proofCoverage = calculateProofFunnel(state, new Date(state.updatedAt));
}

function keepNewestRecordEntries(record, maximum, rank) {
  const entries = Object.entries(record);
  if (entries.length <= maximum) return record;
  return Object.fromEntries(entries.sort((left, right) => rank(right[1]) - rank(left[1]) || left[0].localeCompare(right[0])).slice(0, maximum));
}

export function retainPriorityPools(record, maximum = MAX_POOLS, protectedMaximum = MAX_PROTECTED_PROVIDER_POOLS, protectedCohort = new Set()) {
  const entries = Object.entries(record);
  if (entries.length <= maximum) return record;
  const newest = (left, right) => (right[1].blockNumber ?? 0) - (left[1].blockNumber ?? 0) || left[0].localeCompare(right[0]);
  const cohortEntries = entries.filter(([key]) => protectedCohort.has(key)).sort(newest).slice(0, maximum);
  const cohortKeys = new Set(cohortEntries.map(([key]) => key));
  const protectedEntries = entries
    .filter(([key, pool]) => !cohortKeys.has(key) && pool.providerEnrichment?.status === "matched")
    .sort(newest)
    .slice(0, Math.min(maximum - cohortEntries.length, protectedMaximum));
  const protectedKeys = new Set([...cohortKeys, ...protectedEntries.map(([key]) => key)]);
  const remaining = entries.filter(([key]) => !protectedKeys.has(key)).sort(newest).slice(0, maximum - protectedEntries.length - cohortEntries.length);
  return Object.fromEntries([...cohortEntries, ...protectedEntries, ...remaining]);
}

async function writeAtomicJson(target, value) {
  return writeAtomicText(target, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeAtomicText(target, serialized, fault) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o640);
  try {
    await handle.writeFile(serialized, "utf8");
    await handle.sync();
    await fault?.("after-checkpoint-file-sync");
  } finally {
    await handle.close();
  }
  try {
    await fault?.("before-checkpoint-rename");
    await rename(temporary, target);
    await fault?.("after-checkpoint-rename");
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  try {
    const directoryHandle = await open(path.dirname(target), "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch { /* directory fsync is not available on every development platform */ }
  return Buffer.byteLength(serialized, "utf8");
}

async function appendDurableLine(target, value) {
  const handle = await open(target, "a", 0o640);
  try {
    await handle.appendFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function truncateDurably(target, length) {
  const handle = await open(target, "r+");
  try {
    await handle.truncate(length);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readStaleLock(lockPath) {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return true;
    try { process.kill(parsed.pid, 0); return false; }
    catch (error) { return error?.code === "ESRCH"; }
  } catch { return true; }
}

function createTrackedDraft(source) {
  const raw = structuredClone(source);
  const changed = new Map();
  let rawByProxy = new WeakMap();
  let proxyByTargetAndPath = new WeakMap();

  const record = (path) => {
    if (!path.length || path[0] === "integrity" || path[0] === "persistence") return;
    changed.set(pathKey(path), path);
  };
  const wrap = (target, path) => {
    if (!target || typeof target !== "object") return target;
    let byPath = proxyByTargetAndPath.get(target);
    if (!byPath) { byPath = new Map(); proxyByTargetAndPath.set(target, byPath); }
    const key = pathKey(path);
    if (byPath.has(key)) return byPath.get(key);
    const proxy = new Proxy(target, {
      get(current, property, receiver) {
        const value = Reflect.get(current, property, receiver);
        if (typeof property === "symbol" || !value || typeof value !== "object") return value;
        return wrap(value, [...path, propertyKey(property)]);
      },
      set(current, property, value, receiver) {
        const segment = propertyKey(property);
        const assigned = cloneAssigned(value, rawByProxy);
        const previous = Reflect.get(current, property, receiver);
        const success = Reflect.set(current, property, assigned, receiver);
        if (success && !Object.is(previous, assigned)) record(Array.isArray(current) ? path : [...path, segment]);
        return success;
      },
      deleteProperty(current, property) {
        const existed = Object.hasOwn(current, property);
        const success = Reflect.deleteProperty(current, property);
        if (success && existed) record(Array.isArray(current) ? path : [...path, propertyKey(property)]);
        return success;
      }
    });
    rawByProxy.set(proxy, target);
    byPath.set(key, proxy);
    return proxy;
  };
  const proxy = wrap(raw, []);
  return {
    raw,
    proxy,
    changed,
    buildPatch() {
      const paths = compactChangedPaths([...changed.values()]);
      return paths.map((path) => {
        const located = valueAtPath(raw, path);
        return located.exists && located.value !== undefined
          ? { op: "set", path, value: located.value }
          : { op: "remove", path };
      });
    },
    release() {
      changed.clear();
      rawByProxy = new WeakMap();
      proxyByTargetAndPath = new WeakMap();
    }
  };
}

function compactChangedPaths(paths) {
  return paths
    .sort((left, right) => left.length - right.length || pathKey(left).localeCompare(pathKey(right)))
    .filter((path, index, all) => !all.slice(0, index).some((parent) => isParentPath(parent, path)));
}

function isParentPath(parent, child) {
  return parent.length <= child.length && parent.every((segment, index) => segment === child[index]);
}

function valueAtPath(state, path) {
  let current = state;
  for (const segment of path) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) return { exists: false };
    current = current[segment];
  }
  return { exists: true, value: current };
}

function cloneAssigned(value, rawByProxy) {
  return detachValue(value, rawByProxy, new WeakMap());
}

function detachValue(value, rawByProxy, seen) {
  if (!value || typeof value !== "object") return value;
  const source = rawByProxy.get(value) ?? value;
  if (seen.has(source)) return seen.get(source);
  if (Array.isArray(source)) {
    const copy = [];
    seen.set(source, copy);
    for (const item of source) copy.push(detachValue(item, rawByProxy, seen));
    return copy;
  }
  const copy = {};
  seen.set(source, copy);
  for (const [key, item] of Object.entries(source)) copy[key] = detachValue(item, rawByProxy, seen);
  return copy;
}

function pathKey(path) {
  return JSON.stringify(path);
}

function propertyKey(property) {
  return typeof property === "string" && /^(?:0|[1-9]\d*)$/.test(property) ? Number(property) : String(property);
}

function validateStateLimits(state, patch) {
  if (Object.keys(state.pools ?? {}).length > MAX_POOLS || Object.keys(state.events ?? {}).length > MAX_CANONICAL_EVENTS) throw new Error("store_record_count_limit_exceeded");
  if ((state.opportunities ?? []).length > MAX_OPPORTUNITIES) throw new Error("store_opportunity_count_limit_exceeded");
  if ((state.metadataQueue ?? []).length > 256 || (state.onchainQueue ?? []).length > 512 || (state.enrichmentQueue ?? []).length > 512) throw new Error("store_queue_limit_exceeded");
  const opportunityBytes = Buffer.byteLength(JSON.stringify(state.opportunities ?? []), "utf8");
  if (opportunityBytes > MAX_OPPORTUNITIES_BYTES) throw new Error("store_opportunity_bytes_limit_exceeded");
  for (const operation of patch) {
    if (operation.op !== "set" || !["pools", "events", "tokenMetadata"].includes(operation.path[0]) || operation.path.length < 2) continue;
    if (Buffer.byteLength(JSON.stringify(operation.value), "utf8") > MAX_RECORD_BYTES) throw new Error("store_record_bytes_limit_exceeded");
  }
}

function trimTail(state, key, maximum) {
  const values = state[key] ?? [];
  if (values.length > maximum) state[key] = values.slice(-maximum);
}

function trimHead(state, key, maximum) {
  const values = state[key] ?? [];
  if (values.length > maximum) state[key] = values.slice(0, maximum);
}

function mergeHealth(base = {}, overlay = {}) {
  return {
    ...base,
    ...overlay,
    loops: { ...(base.loops ?? {}), ...(overlay.loops ?? {}) },
    rpc: overlay.rpc ?? base.rpc
  };
}

function initialStoreMetrics() {
  const heap = getHeapStatistics();
  return {
    transactions: 0,
    noOpTransactions: 0,
    statusOnlyUpdates: 0,
    logicalDeltaBytes: 0,
    journalBytes: 0,
    checkpointBytes: 0,
    checkpoints: 0,
    checkpointFailures: 0,
    transactionMs: 0,
    statusOnlyMs: 0,
    checkpointMs: 0,
    checkpointCpuMs: 0,
    checkpointIntegrityMs: 0,
    checkpointSerializeMs: 0,
    checkpointWriteMs: 0,
    checkpointWriteCpuMs: 0,
    checkpointDiskWaitMs: 0,
    cpuMicros: 0,
    queuePeak: 0,
    queueWaitMs: 0,
    backpressureWaits: 0,
    recoveryCount: 0,
    recoveredTransactions: 0,
    recoveryMs: 0,
    tornTailBytes: 0,
    lastCheckpointError: undefined,
    lastLogAtMs: 0,
    structuredCloneCalls: 0,
    maxCloneSourceBytes: 0,
    maxJournalMessageBytes: 0,
    maxCheckpointMessageBytes: 0,
    maxObservedStateBytes: 0,
    maxObservedMessageBytes: 0,
    resourceSamples: 0,
    peakHeapUsed: 0,
    peakExternal: 0,
    peakArrayBuffers: 0,
    peakRss: 0,
    peakCgroupMemory: 0,
    runtime: {
      node: process.version,
      isMainThread,
      threadId,
      heapLimitBytes: heap.heap_size_limit,
      resourceLimits: {
        maxOldGenerationSizeMb: resourceLimits.maxOldGenerationSizeMb,
        maxYoungGenerationSizeMb: resourceLimits.maxYoungGenerationSizeMb,
        codeRangeSizeMb: resourceLimits.codeRangeSizeMb,
        stackSizeMb: resourceLimits.stackSizeMb
      },
      execArgvFlags: process.execArgv.filter((entry) => entry.startsWith("--")).map((entry) => entry.split("=", 1)[0]).slice(0, 16)
    },
    resourcePhases: {},
    reasons: {}
  };
}

function readCgroupMemoryCurrent() {
  if (process.platform !== "linux") return undefined;
  try {
    const membership = readFileSync("/proc/self/cgroup", "utf8").split(/\r?\n/).find((line) => line.startsWith("0::"));
    const relative = membership?.slice(3) || "/";
    return Number(readFileSync(path.resolve("/sys/fs/cgroup", `.${relative}`, "memory.current"), "utf8").trim());
  } catch {
    return undefined;
  }
}

function serializedLineBytes(value) {
  return Buffer.byteLength(`${JSON.stringify(value)}\n`, "utf8");
}

function elapsedMs(started) {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function boundedOption(value, fallback, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function safeFailure(error) {
  const value = error?.reasonCode ?? error?.code ?? error?.name ?? "checkpoint_failure";
  return String(value).replace(/[^a-z0-9_-]/gi, "_").slice(0, 120).toLowerCase();
}
