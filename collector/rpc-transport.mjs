import { JsonRpcClient, JsonRpcRequestError } from "./rpc.mjs";
import { BoundedSemaphore, abortableDelay, throwIfAborted } from "./async-control.mjs";

const CHAIN_ID = 8453;
const METHODS = new Set(["eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getLogs", "eth_getCode", "eth_call"]);
const HASH = /^0x[0-9a-f]{64}$/i;
const HEX = /^0x[0-9a-f]+$/i;
const QUARANTINE = /rpc_(wrong_chain|block_hash_conflict|malformed|response_missing|invalid_block)/;

export function configuredRpcEndpoints(environment = process.env) {
  const candidates = [{ label: "primary", url: environment.BASE_RPC_HTTP_URL?.trim() || "https://mainnet.base.org" }];
  // Only explicit Base configuration is accepted; never infer the chain from an
  // arbitrary RPC secret in the environment. Labels cannot contain a hostname.
  for (const key of ["BASE_RPC_URL", "BASE_RPC_URLS", "BASE_RPC_FALLBACK_URLS", "BASE_RPC_HTTP_URLS", "ONCHAIN_BASE_RPC_URLS"]) {
    for (const url of (environment[key] ?? "").split(/[\s,]+/).filter(Boolean)) candidates.push({ label: `configured-${candidates.length}`, url });
  }
  // Official Base public endpoints. No pending/preconfirmation reads are used.
  candidates.push({ label: "base-public-standard", url: "https://mainnet.base.org" });
  candidates.push({ label: "base-public-fallback", url: "https://mainnet-preconf.base.org" });
  const seen = new Set();
  return candidates.filter((item) => {
    if (!/^https?:\/\//i.test(item.url) || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  }).slice(0, 4);
}

export class RpcTransportPool {
  constructor(endpoints, { now = () => Date.now(), random = Math.random, fetchImpl = fetch, timeoutMs = 8_000, globalConcurrency = 2, minimumIntervalMs = 250, endpointIntervalMs = 500, cooldownMs = 5_000, delayImpl = abortableDelay } = {}) {
    if (!endpoints?.length) throw new Error("rpc_endpoints_required");
    this.now = now; this.random = random; this.delay = delayImpl;
    this.minimumIntervalMs = minimumIntervalMs; this.endpointIntervalMs = endpointIntervalMs; this.cooldownMs = cooldownMs;
    this.global = new BoundedSemaphore(Math.min(2, Math.max(1, globalConcurrency)));
    this.nextStartAt = 0;
    this.continuity = undefined;
    this.minimumHead = 0;
    this.metrics = { logicalRequests: 0, requests: 0, calls: 0, successes: 0, failures: 0, failovers: 0, retries: 0, circuitOpens: 0 };
    this.endpoints = endpoints.map((item, index) => ({
      label: /^(primary|configured-\d+|base-public-(standard|fallback))$/.test(item.label) ? item.label : `configured-${index}`,
      client: new JsonRpcClient(item.url, { fetchImpl, timeoutMs, retries: 0, circuitFailureThreshold: Infinity }),
      gate: new BoundedSemaphore(1), nextStartAt: 0, status: "unvalidated", validatedAt: 0, retryAt: 0, methods: {}, proofCache: new Map()
    }));
  }

  client({ batchPaceMs = 0 } = {}) { return new PooledRpcClient(this, batchPaceMs); }

  setContinuity(block) {
    if (!Number.isSafeInteger(block?.number) || block.number < 1) return;
    this.continuity = { number: block.number, hash: HASH.test(block.hash ?? "") ? block.hash.toLowerCase() : undefined };
  }

  method(endpoint, name) {
    return endpoint.methods[name] ??= { state: "closed", consecutiveFailures: 0, openUntil: 0, success: 0, failure: 0, failover: 0, errors: {}, lastSuccessAt: undefined, lastError: undefined };
  }

  async wire(endpoint, calls, signal) {
    const releaseEndpoint = await endpoint.gate.acquire(signal);
    let releaseGlobal;
    try {
      releaseGlobal = await this.global.acquire(signal);
      const now = this.now();
      const start = Math.max(now, this.nextStartAt, endpoint.nextStartAt);
      this.nextStartAt = start + this.minimumIntervalMs;
      endpoint.nextStartAt = start + (endpoint.label === "primary" ? this.endpointIntervalMs : Math.max(1_000, this.endpointIntervalMs));
      if (start > now) await this.delay(start - now, signal);
      throwIfAborted(signal);
      this.metrics.requests += 1; this.metrics.calls += calls.length;
      const outcomes = await endpoint.client.batchOutcomes(calls, { signal });
      return outcomes.map((item) => ({ ...item, endpointLabel: endpoint.label }));
    } finally { releaseGlobal?.(); releaseEndpoint(); }
  }

  async raw(endpoint, method, params, signal) {
    const outcome = (await this.wire(endpoint, [{ method, params }], signal))[0];
    if (!outcome.ok) throw new JsonRpcRequestError(outcome.reasonCode, outcome);
    return outcome.value;
  }

  async validate(endpoint, signal) {
    if (endpoint.status === "quarantined") throw new JsonRpcRequestError(endpoint.reasonCode, { retryable: false, endpointLabel: endpoint.label });
    if (endpoint.retryAt > this.now()) throw new JsonRpcRequestError("rpc_endpoint_cooldown", { endpointLabel: endpoint.label });
    if (endpoint.status === "eligible" && this.now() - endpoint.validatedAt < 30_000) return;
    const chain = await this.raw(endpoint, "eth_chainId", [], signal);
    if (!HEX.test(chain) || Number.parseInt(chain, 16) !== CHAIN_ID) throw new JsonRpcRequestError("rpc_wrong_chain", { retryable: false, method: "eth_chainId" });
    const latest = validBlock(await this.raw(endpoint, "eth_getBlockByNumber", ["latest", false], signal));
    if (latest.timestamp > this.now() + 30_000) throw new JsonRpcRequestError("rpc_invalid_block_time", { retryable: false });
    if (this.now() - latest.timestamp > 120_000 || latest.number < Math.max(this.minimumHead - 16, this.continuity?.number ?? 0)) throw new JsonRpcRequestError("rpc_endpoint_behind");
    if (this.continuity) {
      const row = validBlock(await this.raw(endpoint, "eth_getBlockByNumber", [hex(this.continuity.number), false], signal), this.continuity.number);
      if (this.continuity.hash && row.hash !== this.continuity.hash) throw new JsonRpcRequestError("rpc_block_hash_conflict", { retryable: false });
      // Migration from the old cursor schema has no hash. The first validated
      // endpoint establishes the checkpoint; every fallback must match it.
      this.continuity.hash ??= row.hash;
    }
    endpoint.status = "eligible"; endpoint.validatedAt = this.now(); endpoint.head = latest.number; endpoint.reasonCode = undefined;
  }

  async verifyProof(endpoint, proof, signal) {
    if (!proof) return;
    if (!Number.isSafeInteger(proof.number) || !HASH.test(proof.hash ?? "")) throw new JsonRpcRequestError("rpc_exact_block_proof_required", { retryable: false });
    const key = `${proof.number}:${proof.hash}`;
    // A short cache only coalesces the same exact confirmed state cycle.
    if ((endpoint.proofCache.get(key) ?? 0) > this.now()) return;
    const value = await this.raw(endpoint, "eth_getBlockByNumber", [hex(proof.number), false], signal);
    if (value === null) throw new JsonRpcRequestError("rpc_endpoint_behind");
    const block = validBlock(value, proof.number);
    if (block.hash !== proof.hash.toLowerCase()) throw new JsonRpcRequestError("rpc_block_hash_conflict", { retryable: false });
    if (proof.timestamp !== undefined && proof.timestamp !== block.timestamp) throw new JsonRpcRequestError("rpc_invalid_block_time", { retryable: false });
    endpoint.proofCache.set(key, this.now() + 5_000);
    if (endpoint.proofCache.size > 64) endpoint.proofCache.delete(endpoint.proofCache.keys().next().value);
  }

  async batchOutcomes(calls, { signal, blockProof } = {}) {
    throwIfAborted(signal);
    if (!calls.length) return [];
    if (calls.length > 32 || calls.some((item) => !METHODS.has(item.method))) throw new JsonRpcRequestError("rpc_request_out_of_budget", { retryable: false });
    if (blockProof) assertExactTags(calls, blockProof.number);
    this.metrics.logicalRequests += 1;
    const methods = [...new Set(calls.map((call) => call.method))];
    let last;
    let attempted = 0;
    for (const endpoint of this.endpoints) {
      if (endpoint.status === "quarantined" || endpoint.retryAt > this.now()) continue;
      const circuits = methods.map((name) => this.method(endpoint, name));
      if (circuits.some((item) => item.openUntil > this.now() || item.state === "half_open")) continue;
      if (attempted >= 2) break; // each endpoint at most once per logical call
      if (attempted) {
        this.metrics.retries += 1;
        await this.delay(100 + Math.floor(this.random() * 150), signal);
      }
      attempted += 1;
      for (const item of circuits) if (item.openUntil) item.state = "half_open";
      let outcomes;
      try {
        await this.validate(endpoint, signal);
        await this.verifyProof(endpoint, blockProof, signal);
        outcomes = await this.wire(endpoint, calls, signal);
        for (let index = 0; index < outcomes.length; index += 1) {
          const outcome = outcomes[index];
          if (outcome.ok && !validResult(calls[index], outcome.value)) outcomes[index] = { ok: false, reasonCode: "rpc_malformed_result", retryable: false, endpointLabel: endpoint.label, method: calls[index].method };
          else if (outcome.ok && calls[index].method === "eth_blockNumber" && Number.parseInt(outcome.value, 16) < this.minimumHead) outcomes[index] = { ok: false, reasonCode: "rpc_endpoint_behind", retryable: true, endpointLabel: endpoint.label, method: calls[index].method };
        }
      } catch (error) {
        if (signal?.aborted) for (const item of circuits) if (item.state === "half_open") item.state = "open";
        throwIfAborted(signal);
        outcomes = calls.map((call) => ({ ok: false, reasonCode: error.reasonCode ?? "rpc_transport_failure", retryable: error.retryable !== false, method: call.method, endpointLabel: endpoint.label }));
      }
      const invalid = outcomes.find((item) => !item.ok && QUARANTINE.test(item.reasonCode));
      if (invalid) {
        endpoint.status = "quarantined"; endpoint.reasonCode = invalid.reasonCode; endpoint.proofCache.clear();
        outcomes = calls.map((call) => ({ ...invalid, ok: false, method: call.method }));
      }
      if (outcomes.some((item) => item.reasonCode === "rpc_endpoint_behind")) { endpoint.status = "behind"; endpoint.retryAt = this.now() + this.cooldownMs; }
      for (const name of methods) {
        const circuit = this.method(endpoint, name);
        const rows = outcomes.filter((item) => item.method === name);
        const failure = rows.find((item) => !item.ok && isProviderFailure(item));
        if (failure) {
          circuit.failure += rows.filter((item) => !item.ok).length;
          circuit.consecutiveFailures += 1;
          circuit.errors[failure.reasonCode] = (circuit.errors[failure.reasonCode] ?? 0) + 1;
          circuit.lastError = { method: name, endpointLabel: endpoint.label, reasonCode: failure.reasonCode, observedAt: iso(this.now()) };
          // First failure backs off this method, including -32016 and forbidden
          // methods. Other methods/endpoints remain available.
          const baseCooldown = failure.retryable === false ? 60_000 : this.cooldownMs;
          circuit.openUntil = this.now() + Math.min(60_000, baseCooldown * 2 ** Math.min(circuit.consecutiveFailures - 1, 4)) + Math.floor(this.random() * 500);
          circuit.state = "open"; circuit.lastError.retryAt = iso(circuit.openUntil);
          this.metrics.circuitOpens += 1;
        } else {
          circuit.success += rows.filter((item) => item.ok).length;
          circuit.consecutiveFailures = 0; circuit.openUntil = 0; circuit.state = "closed";
          circuit.lastSuccessAt = iso(this.now());
          if (circuit.lastError && !circuit.lastError.recoveredAt) circuit.lastError.recoveredAt = iso(this.now());
        }
      }
      last = outcomes;
      // Retry the ENTIRE batch at the same exact block, never splice a partial
      // response from one source into a second source's state evidence.
      if (!outcomes.some((item) => !item.ok && isProviderFailure(item))) {
        if (attempted > 1) { this.metrics.failovers += 1; for (const name of methods) this.method(endpoint, name).failover += 1; }
        this.metrics.successes += outcomes.filter((item) => item.ok).length;
        this.metrics.failures += outcomes.filter((item) => !item.ok).length;
        return outcomes;
      }
    }
    const outcomes = last ?? calls.map((call) => ({ ok: false, reasonCode: "rpc_all_endpoints_cooling_down", retryable: true, method: call.method }));
    this.metrics.failures += outcomes.filter((item) => !item.ok).length;
    return outcomes;
  }

  snapshot() {
    return {
      ...this.metrics, endpointCount: this.endpoints.length, active: this.global.active, queued: this.global.waiters.length, peakConcurrency: this.global.peak,
      budget: { globalConcurrency: this.global.limit, endpointConcurrency: 1, maximumAttempts: 2, minimumIntervalMs: this.minimumIntervalMs },
      endpoints: this.endpoints.map((item) => ({ label: item.label, status: item.status, reasonCode: item.reasonCode, head: item.head, validatedAt: item.validatedAt ? iso(item.validatedAt) : undefined, methods: structuredClone(item.methods) }))
    };
  }
}

export class PooledRpcClient extends JsonRpcClient {
  constructor(pool, batchPaceMs) { super("https://unused.invalid", { retries: 0, timeoutMs: 8_000, batchPaceMs }); this.pool = pool; }
  batchOutcomes(calls, options) { return this.pool.batchOutcomes(calls, options); }
  circuitSnapshot() { return this.pool.snapshot(); }
  async confirmedBlock(options = {}) {
    const head = await this.blockNumber(options);
    const number = Math.max(1, head - 2);
    const row = validBlock(await this.getBlock(number, options), number);
    this.pool.minimumHead = Math.max(this.pool.minimumHead, number);
    return { ...row, observedAt: iso(row.timestamp) };
  }
}

export function validBlock(value, expectedNumber) {
  if (!value || !HEX.test(value.number ?? "") || !HASH.test(value.hash ?? "") || !HEX.test(value.timestamp ?? "")) throw new JsonRpcRequestError("rpc_invalid_block", { retryable: false });
  const number = Number.parseInt(value.number, 16), timestamp = Number.parseInt(value.timestamp, 16) * 1_000;
  if (!Number.isSafeInteger(number) || !Number.isSafeInteger(timestamp) || (expectedNumber !== undefined && number !== expectedNumber)) throw new JsonRpcRequestError("rpc_invalid_block", { retryable: false });
  return { number, hash: value.hash.toLowerCase(), timestamp };
}
function validResult(call, value) {
  if (["eth_chainId", "eth_blockNumber"].includes(call.method)) return typeof value === "string" && HEX.test(value) && Number.isSafeInteger(Number.parseInt(value, 16));
  if (["eth_call", "eth_getCode"].includes(call.method)) return typeof value === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(value);
  if (call.method === "eth_getLogs") return Array.isArray(value);
  if (call.method === "eth_getBlockByNumber") { try { validBlock(value, HEX.test(call.params[0]) ? Number.parseInt(call.params[0], 16) : undefined); return true; } catch { return false; } }
  return false;
}
function assertExactTags(calls, number) {
  for (const call of calls) {
    const tag = call.method === "eth_call" || call.method === "eth_getCode" ? call.params[1] : undefined;
    if (tag !== undefined && tag !== hex(number)) throw new JsonRpcRequestError("rpc_exact_block_tag_mismatch", { retryable: false, method: call.method });
  }
}
function isProviderFailure(item) { return item.retryable || QUARANTINE.test(item.reasonCode) || /rpc_(http_|invalid_params|error_-3260)/.test(item.reasonCode); }
function hex(number) { return `0x${number.toString(16)}`; }
function iso(time) { return new Date(time).toISOString(); }
