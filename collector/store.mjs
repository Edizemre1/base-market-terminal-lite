import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BASE_CHAIN_ID, COLLECTOR_VERSION, FACTORY_REGISTRY } from "./factory-registry.mjs";
import { buildCanonicalOpportunities, MAX_EVENT_RING, MAX_HISTORY_RING, MAX_PRICE_AGE_MS, MAX_RECONCILIATION_RING } from "./model.mjs";
import { resolveOnchainPoolEvidence } from "./onchain-state.mjs";

export const STORE_SCHEMA_VERSION = 1;
export const MAX_CANONICAL_EVENTS = 5_000;
export const MAX_POOLS = 2_000;
export const MAX_PROTECTED_PROVIDER_POOLS = 512;
export const MAX_MARKET_SNAPSHOTS = 96;
export const MAX_WAL_LINES = 512;

export class DurableDiscoveryStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.statePath = path.join(this.directory, "state.json");
    this.walPath = path.join(this.directory, "wal.ndjson");
    this.lockPath = path.join(this.directory, "collector.lock");
    this.state = undefined;
    this.lockHandle = undefined;
    this.closed = false;
    this.transactionTail = Promise.resolve();
  }

  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o750 });
    await this.acquireLock();
    try {
      this.state = await this.loadOrInitialize();
      await this.compactWal();
      return structuredClone(this.state);
    } catch (error) {
      await this.releaseLock();
      throw error;
    }
  }

  read() {
    if (!this.state) throw new Error("Store is not open");
    return structuredClone(this.state);
  }

  async transact(reason, mutator, afterDerive) {
    const operation = this.transactionTail.then(() => this.performTransaction(reason, mutator, afterDerive));
    this.transactionTail = operation.catch(() => {});
    return operation;
  }

  async performTransaction(reason, mutator, afterDerive) {
    if (!this.state || this.closed) throw new Error("Store is not writable");
    const transactionId = randomUUID();
    const beforeDigest = this.state.integrity.digest;
    const draft = structuredClone(this.state);
    const result = await mutator(draft);
    const next = result && typeof result === "object" ? result : draft;
    next.schemaVersion = STORE_SCHEMA_VERSION;
    next.collectorVersion = COLLECTOR_VERSION;
    next.updatedAt = new Date().toISOString();
    enforceRetention(next);
    expireStalePriceAnchors(next, new Date(next.updatedAt));
    resolveOnchainPoolEvidence(next, new Date(next.updatedAt));
    next.opportunities = buildCanonicalOpportunities(pricingPoolsForState(next), next.tokenMetadata ?? {}, next.opportunities ?? [], new Date(next.updatedAt));
    synchronizeDerivedHealth(next);
    if (afterDerive) await afterDerive(next);
    enforceRetention(next);
    next.integrity = createIntegrity(next);
    const prepare = { type: "prepare", transactionId, at: next.updatedAt, reason, beforeDigest, afterDigest: next.integrity.digest };
    await appendDurableLine(this.walPath, prepare);
    await writeAtomicJson(this.statePath, next);
    await appendDurableLine(this.walPath, { type: "commit", transactionId, at: next.updatedAt, afterDigest: next.integrity.digest });
    this.state = next;
    if ((await lineCount(this.walPath)) > MAX_WAL_LINES * 2) await this.compactWal();
    return structuredClone(next);
  }

  integrityCheck() {
    if (!this.state) return { ok: false, reason: "store_not_open" };
    const expected = createIntegrity(this.state);
    return expected.digest === this.state.integrity?.digest
      ? { ok: true, schemaVersion: this.state.schemaVersion, digest: expected.digest }
      : { ok: false, reason: "digest_mismatch", expected: expected.digest, actual: this.state.integrity?.digest };
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.releaseLock();
  }

  async loadOrInitialize() {
    try {
      const raw = await readFile(this.statePath, "utf8");
      const parsed = migrate(JSON.parse(raw));
      const expected = createIntegrity(parsed);
      if (parsed.integrity?.digest !== expected.digest) throw new Error("Store integrity digest mismatch");
      return parsed;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const state = initialState();
      await writeAtomicJson(this.statePath, state);
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

  async compactWal() {
    let rows = [];
    try {
      rows = (await readFile(this.walPath, "utf8")).split(/\r?\n/).filter(Boolean).slice(-MAX_WAL_LINES);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const temporary = `${this.walPath}.${process.pid}.tmp`;
    await writeFile(temporary, rows.length ? `${rows.join("\n")}\n` : "", { encoding: "utf8", mode: 0o640 });
    await rename(temporary, this.walPath);
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
  return { algorithm: "sha256", digest: createHash("sha256").update(stableStringify(clone)).digest("hex") };
}

export function readStoreSnapshotSync(directory) {
  try {
    const file = path.join(path.resolve(directory), "state.json");
    const state = migrate(JSON.parse(readFileSync(file, "utf8")));
    const expected = createIntegrity(state);
    if (state.integrity?.digest !== expected.digest) return { ok: false, reason: "digest_mismatch" };
    return { ok: true, state };
  } catch (error) {
    return { ok: false, reason: error?.code === "ENOENT" ? "store_unavailable" : "store_invalid" };
  }
}

function migrate(state) {
  if (state?.schemaVersion === STORE_SCHEMA_VERSION) return state;
  throw new Error(`Unsupported store schema: ${state?.schemaVersion ?? "missing"}`);
}

function enforceRetention(state) {
  state.history = (state.history ?? []).slice(-MAX_HISTORY_RING);
  state.reconciliation = (state.reconciliation ?? []).slice(-MAX_RECONCILIATION_RING);
  state.eventRing = (state.eventRing ?? []).slice(-MAX_EVENT_RING);
  state.marketSnapshots = (state.marketSnapshots ?? []).slice(-MAX_MARKET_SNAPSHOTS);
  state.metadataQueue = (state.metadataQueue ?? []).slice(-256);
  state.onchainQueue = (state.onchainQueue ?? []).slice(0, 512);
  state.enrichmentQueue = (state.enrichmentQueue ?? []).slice(0, 512);
  state.events = keepNewestRecordEntries(state.events ?? {}, MAX_CANONICAL_EVENTS, (event) => event.blockNumber ?? 0);
  state.pools = retainPriorityPools(state.pools ?? {}, MAX_POOLS, MAX_PROTECTED_PROVIDER_POOLS);
  const retainedTokens = new Set(Object.values(state.pools).flatMap((pool) => [pool.token0, pool.token1]));
  state.tokenMetadata = Object.fromEntries(Object.entries(state.tokenMetadata ?? {}).filter(([address]) => retainedTokens.has(address)));
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
}

function keepNewestRecordEntries(record, maximum, rank) {
  const entries = Object.entries(record);
  if (entries.length <= maximum) return record;
  return Object.fromEntries(entries.sort((left, right) => rank(right[1]) - rank(left[1]) || left[0].localeCompare(right[0])).slice(0, maximum));
}

export function retainPriorityPools(record, maximum = MAX_POOLS, protectedMaximum = MAX_PROTECTED_PROVIDER_POOLS) {
  const entries = Object.entries(record);
  if (entries.length <= maximum) return record;
  const newest = (left, right) => (right[1].blockNumber ?? 0) - (left[1].blockNumber ?? 0) || left[0].localeCompare(right[0]);
  const protectedEntries = entries
    .filter(([, pool]) => pool.providerEnrichment?.status === "matched")
    .sort(newest)
    .slice(0, Math.min(maximum, protectedMaximum));
  const protectedKeys = new Set(protectedEntries.map(([key]) => key));
  const remaining = entries.filter(([key]) => !protectedKeys.has(key)).sort(newest).slice(0, maximum - protectedEntries.length);
  return Object.fromEntries([...protectedEntries, ...remaining]);
}

async function writeAtomicJson(target, value) {
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o640);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  try {
    const directoryHandle = await open(path.dirname(target), "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } catch { /* directory fsync is not available on every development platform */ }
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

async function readStaleLock(lockPath) {
  try {
    const parsed = JSON.parse(await readFile(lockPath, "utf8"));
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return true;
    try { process.kill(parsed.pid, 0); return false; }
    catch (error) { return error?.code === "ESRCH"; }
  } catch { return true; }
}

async function lineCount(file) {
  try { return (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).length; }
  catch (error) { return error?.code === "ENOENT" ? 0 : Promise.reject(error); }
}

function stableStringify(value, space) {
  return JSON.stringify(sortValue(value), null, space);
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
