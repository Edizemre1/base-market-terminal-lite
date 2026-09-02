const SELECTOR = Object.freeze({
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  factory: "0xc45a0155",
  getReserves: "0x0902f1ac",
  slot0: "0x3850c7bd",
  liquidity: "0x1a686502"
});

import { FACTORY_REGISTRY } from "./factory-registry.mjs";

export class JsonRpcClient {
  constructor(url, { timeoutMs = 12_000, retries = 3, circuitFailureThreshold = 4, circuitCooldownMs = 15_000, now = () => new Date(), fetchImpl = fetch, delayImpl = delay } = {}) {
    if (!/^https?:\/\//i.test(url ?? "")) throw new Error("A valid HTTP RPC URL is required");
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.nextId = 1;
    this.circuitFailureThreshold = circuitFailureThreshold;
    this.circuitCooldownMs = circuitCooldownMs;
    this.now = now;
    this.fetchImpl = fetchImpl;
    this.delayImpl = delayImpl;
    this.consecutiveFailures = 0;
    this.openUntil = 0;
    this.metrics = { requests: 0, calls: 0, retries: 0, timeouts: 0, failures: 0, successes: 0, circuitOpens: 0 };
  }

  async request(method, params = [], options = {}) {
    return (await this.batch([{ method, params }], options))[0];
  }

  async batch(calls, { signal } = {}) {
    const outcomes = await this.batchOutcomes(calls, { signal });
    const failure = outcomes.find((outcome) => !outcome.ok);
    if (failure) throw new JsonRpcRequestError(failure.reasonCode, failure);
    return outcomes.map((outcome) => outcome.value);
  }

  async batchOutcomes(calls, { signal } = {}) {
    if (!calls.length) return [];
    this.metrics.calls += calls.length;
    if (this.now().getTime() < this.openUntil) {
      return calls.map(() => ({ ok: false, reasonCode: "rpc_circuit_open", retryable: true, retryAt: new Date(this.openUntil).toISOString() }));
    }
    const requests = calls.map((call) => ({ jsonrpc: "2.0", id: this.nextId++, method: call.method, params: call.params ?? [] }));
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        this.metrics.requests += 1;
        const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
        const response = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requests),
          signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
        });
        if (!response.ok) throw new JsonRpcRequestError(`rpc_http_${response.status}`, { retryable: response.status === 408 || response.status === 429 || response.status >= 500 });
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : [payload];
        const byId = new Map(rows.map((row) => [row.id, row]));
        const outcomes = requests.map((request) => {
          const row = byId.get(request.id);
          if (!row) return { ok: false, reasonCode: "rpc_response_missing", retryable: true, method: request.method };
          if (row.error) return { ok: false, reasonCode: classifyRpcError(row.error), retryable: isRetryableRpcError(row.error), method: request.method, rpcCode: row.error.code };
          if (typeof row.result !== "string" && request.method === "eth_call") return { ok: false, reasonCode: "rpc_malformed_response", retryable: false, method: request.method };
          if (row.result === "0x" && request.method === "eth_call") return { ok: false, reasonCode: "rpc_empty_response", retryable: false, method: request.method };
          return { ok: true, value: row.result, method: request.method };
        });
        const retryableRowFailure = outcomes.some((outcome) => !outcome.ok && outcome.retryable);
        if (retryableRowFailure && attempt < this.retries) {
          this.metrics.retries += 1;
          await this.delayImpl(Math.min(2_000, 250 * 2 ** attempt));
          continue;
        }
        this.consecutiveFailures = retryableRowFailure ? this.consecutiveFailures + 1 : 0;
        if (this.consecutiveFailures >= this.circuitFailureThreshold) {
          this.openUntil = this.now().getTime() + this.circuitCooldownMs;
          this.metrics.circuitOpens += 1;
        } else if (!retryableRowFailure) {
          this.openUntil = 0;
        }
        this.metrics.successes += outcomes.filter((outcome) => outcome.ok).length;
        this.metrics.failures += outcomes.filter((outcome) => !outcome.ok).length;
        return outcomes;
      } catch (error) {
        const reasonCode = classifyTransportError(error);
        if (reasonCode === "rpc_timeout") this.metrics.timeouts += 1;
        if (attempt === this.retries || error?.retryable === false) {
          this.metrics.failures += calls.length;
          this.consecutiveFailures += 1;
          if (this.consecutiveFailures >= this.circuitFailureThreshold) {
            this.openUntil = this.now().getTime() + this.circuitCooldownMs;
            this.metrics.circuitOpens += 1;
          }
          return calls.map(() => ({ ok: false, reasonCode, retryable: error?.retryable !== false }));
        }
        this.metrics.retries += 1;
        await this.delayImpl(Math.min(2_000, 250 * 2 ** attempt));
      }
    }
    return calls.map(() => ({ ok: false, reasonCode: "rpc_retry_exhausted", retryable: true }));
  }

  circuitSnapshot() {
    return {
      state: this.now().getTime() < this.openUntil ? "open" : "closed",
      openUntil: this.openUntil ? new Date(this.openUntil).toISOString() : undefined,
      consecutiveFailures: this.consecutiveFailures,
      ...this.metrics
    };
  }

  async blockNumber(options = {}) {
    return hexToSafeNumber(await this.request("eth_blockNumber", [], options));
  }

  async getLogs({ fromBlock, toBlock, addresses, topics }) {
    const filter = {
      fromBlock: toHex(fromBlock),
      toBlock: toHex(toBlock),
      address: addresses,
      topics: [topics]
    };
    const logs = await this.request("eth_getLogs", [filter]);
    return Array.isArray(logs) ? logs : [];
  }

  async getBlock(blockNumber, options = {}) {
    return this.request("eth_getBlockByNumber", [toHex(blockNumber), false], options);
  }

  async getCode(address, block = "latest", options = {}) {
    return this.request("eth_getCode", [address, typeof block === "number" ? toHex(block) : block], options);
  }

  async call(address, data, block = "latest", options = {}) {
    return this.request("eth_call", [{ to: address, data }, typeof block === "number" ? toHex(block) : block], options);
  }
}

export async function enrichTokenMetadata(rpc, tokenAddress, blockNumber, now = new Date(), options = {}) {
  const fallback = {
    address: tokenAddress,
    name: undefined,
    symbol: undefined,
    decimals: undefined,
    status: "unavailable",
    source: "erc20_contract",
    verificationState: "pending",
    codeExists: false,
    observedAt: now.toISOString(),
    blockNumber
  };
  try {
    const code = await rpc.getCode(tokenAddress, blockNumber, options);
    if (!code || code === "0x") return { ...fallback, failureReason: "token_code_missing", verificationState: "rejected", retryable: false };
    const calls = [SELECTOR.name, SELECTOR.symbol, SELECTOR.decimals].map((data) => ({ method: "eth_call", params: [{ to: tokenAddress, data }, toHex(blockNumber)] }));
    const outcomes = typeof rpc.batchOutcomes === "function"
      ? await rpc.batchOutcomes(calls, options)
      : (await rpc.batch(calls, options)).map((value) => ({ ok: true, value }));
    const name = outcomes[0]?.ok ? decodeAbiText(outcomes[0].value) : undefined;
    const symbol = outcomes[1]?.ok ? decodeAbiText(outcomes[1].value) : undefined;
    const decimals = outcomes[2]?.ok ? decodeAbiUint(outcomes[2].value) : undefined;
    const validDecimals = validDecimalsValue(decimals) ? decimals : undefined;
    const complete = Boolean(name && symbol && validDecimals !== undefined);
    const decimalsFailure = metadataDecimalsFailure(outcomes[2], validDecimals);
    return {
      ...fallback,
      name,
      symbol,
      decimals: validDecimals,
      codeExists: true,
      status: complete ? "complete" : "partial",
      verificationState: validDecimals !== undefined ? "verified" : decimalsFailure === "invalid_decimals" ? "quarantined" : "pending",
      failureReason: decimalsFailure,
      retryable: decimalsFailure ? decimalsFailure !== "invalid_decimals" : false,
      retryAt: decimalsFailure && decimalsFailure !== "invalid_decimals" ? new Date(now.getTime() + 60_000).toISOString() : undefined
    };
  } catch (error) {
    const failureReason = classifyTransportError(error);
    return { ...fallback, codeExists: true, status: "partial", verificationState: "pending", failureReason, retryable: true, retryAt: new Date(now.getTime() + 60_000).toISOString() };
  }
}

export async function verifyPoolBinding(rpc, pool, blockNumber) {
  try {
    const codeAddress = pool.poolAddress ?? pool.factoryAddress;
    const code = await rpc.getCode(codeAddress, blockNumber);
    if (!code || code === "0x") return { ok: false, reason: "contract_code_missing" };
    if (!pool.poolAddress) return { ok: true, kind: "manager_pool_id" };
    const results = await rpc.batch([
      { method: "eth_call", params: [{ to: pool.poolAddress, data: SELECTOR.token0 }, toHex(blockNumber)] },
      { method: "eth_call", params: [{ to: pool.poolAddress, data: SELECTOR.token1 }, toHex(blockNumber)] },
      { method: "eth_call", params: [{ to: pool.poolAddress, data: SELECTOR.factory }, toHex(blockNumber)] }
    ]);
    const token0 = decodeAbiAddress(results[0]);
    const token1 = decodeAbiAddress(results[1]);
    const factory = decodeAbiAddress(results[2]);
    if (token0 && token0 !== pool.token0) return { ok: false, reason: "token0_mismatch" };
    if (token1 && token1 !== pool.token1) return { ok: false, reason: "token1_mismatch" };
    if (factory && factory !== pool.factoryAddress) return { ok: false, reason: "factory_mismatch" };
    return { ok: true, kind: "pool_contract", token0, token1, factory };
  } catch {
    // Some verified pool types do not expose the V2/V3 getter surface. The
    // factory event and deployed pool code remain the authoritative binding.
    return { ok: true, kind: "factory_event_and_code" };
  }
}

export async function verifyPoolBindings(rpc, pools, { batchSize = 2 } = {}) {
  if (typeof rpc?.batchOutcomes !== "function") return Promise.all(pools.map((pool) => verifyPoolBinding(rpc, pool, pool.blockNumber)));
  const results = [];
  const boundedBatchSize = Math.min(2, Math.max(1, batchSize));
  for (let offset = 0; offset < pools.length; offset += boundedBatchSize) {
    const batch = pools.slice(offset, offset + boundedBatchSize);
    const calls = [];
    const layouts = batch.map((pool) => {
      const codeIndex = calls.push({ method: "eth_getCode", params: [pool.poolAddress ?? pool.factoryAddress, toHex(pool.blockNumber)] }) - 1;
      if (!pool.poolAddress) return { codeIndex };
      const token0Index = calls.push({ method: "eth_call", params: [{ to: pool.poolAddress, data: SELECTOR.token0 }, toHex(pool.blockNumber)] }) - 1;
      const token1Index = calls.push({ method: "eth_call", params: [{ to: pool.poolAddress, data: SELECTOR.token1 }, toHex(pool.blockNumber)] }) - 1;
      const factoryIndex = calls.push({ method: "eth_call", params: [{ to: pool.poolAddress, data: SELECTOR.factory }, toHex(pool.blockNumber)] }) - 1;
      return { codeIndex, token0Index, token1Index, factoryIndex };
    });
    const outcomes = await rpc.batchOutcomes(calls);
    for (let index = 0; index < batch.length; index += 1) {
      const pool = batch[index];
      const layout = layouts[index];
      const code = outcomes[layout.codeIndex];
      if (!code?.ok) {
        results.push({ ok: false, reason: code?.reasonCode ?? "contract_code_unavailable", retryable: code?.retryable !== false });
        continue;
      }
      if (!code.value || code.value === "0x") {
        results.push({ ok: false, reason: "contract_code_missing", retryable: false });
        continue;
      }
      if (!pool.poolAddress) {
        results.push({ ok: true, kind: "manager_pool_id" });
        continue;
      }
      const getters = [outcomes[layout.token0Index], outcomes[layout.token1Index], outcomes[layout.factoryIndex]];
      if (getters.some((outcome) => !outcome?.ok)) {
        results.push({ ok: true, kind: "factory_event_and_code" });
        continue;
      }
      const token0 = decodeAbiAddress(getters[0].value);
      const token1 = decodeAbiAddress(getters[1].value);
      const factory = decodeAbiAddress(getters[2].value);
      if (token0 && token0 !== pool.token0) results.push({ ok: false, reason: "token0_mismatch", retryable: false });
      else if (token1 && token1 !== pool.token1) results.push({ ok: false, reason: "token1_mismatch", retryable: false });
      else if (factory && factory !== pool.factoryAddress) results.push({ ok: false, reason: "factory_mismatch", retryable: false });
      else results.push({ ok: true, kind: "pool_contract", token0, token1, factory });
    }
  }
  return results;
}

export async function inspectRegisteredPool(rpc, poolAddress, block = "latest", options = {}) {
  const address = normalizeAddress(poolAddress);
  if (!address) return { ok: false, reason: "malformed_pool_address", retryable: false };
  try {
    const code = await rpc.getCode(address, block, options);
    if (!code || code === "0x") return { ok: false, reason: "contract_code_missing", retryable: false };
    const [token0Raw, token1Raw, factoryRaw] = await Promise.all([
      rpc.call(address, SELECTOR.token0, block, options),
      rpc.call(address, SELECTOR.token1, block, options),
      rpc.call(address, SELECTOR.factory, block, options)
    ]);
    const token0 = decodeAbiAddress(token0Raw);
    const token1 = decodeAbiAddress(token1Raw);
    const factoryAddress = decodeAbiAddress(factoryRaw);
    if (!token0 || !token1 || !factoryAddress) return { ok: false, reason: "identity_getter_unavailable", retryable: false };
    const registry = FACTORY_REGISTRY.find((entry) => entry.enabled && entry.address === factoryAddress);
    if (!registry) return { ok: false, reason: "unregistered_factory", retryable: false, token0, token1, factoryAddress };
    return { ok: true, token0, token1, factoryAddress, registry };
  } catch {
    return { ok: false, reason: "identity_read_failed", retryable: true };
  }
}

export async function readTokenDecimals(rpc, tokenAddress, block = "latest", options = {}) {
  const address = normalizeAddress(tokenAddress);
  if (!address) return { ok: false, reasonCode: "malformed_token_address", retryable: false };
  try {
    const code = await rpc.getCode(address, block, options);
    if (!code || code === "0x") return { ok: false, reasonCode: "token_code_missing", retryable: false };
    const decimals = decodeAbiUint(await rpc.call(address, SELECTOR.decimals, block, options));
    return validDecimalsValue(decimals)
      ? { ok: true, decimals, observedAt: new Date().toISOString() }
      : { ok: false, reasonCode: "invalid_decimals", retryable: false };
  } catch {
    return { ok: false, reasonCode: "decimals_read_failed", retryable: true };
  }
}

export async function readSupportedPoolState(rpc, pool, metadata = {}, block = "latest", options = {}) {
  const registry = FACTORY_REGISTRY.find((entry) => entry.id === pool?.factoryId);
  if (!registry || !pool?.poolAddress) return { status: "unsupported", reasonCode: "provider_enrichment_required" };
  const capabilities = registry.capabilities;
  if (!capabilities.identityReadable) return { status: "unsupported", reasonCode: "provider_enrichment_required", capabilities };
  const decimals0 = metadata[pool.token0]?.decimals;
  const decimals1 = metadata[pool.token1]?.decimals;
  if (!validDecimals(decimals0) || !validDecimals(decimals1)) {
    return { status: "rejected", reasonCode: "invalid_decimals", retryable: false, capabilities };
  }
  try {
    const tag = blockTag(block);
    if (capabilities.reservesReadable) {
      const raw = await rpc.call(pool.poolAddress, SELECTOR.getReserves, block, options);
      const reserve0 = decodeAbiBigUint(raw, 0);
      const reserve1 = decodeAbiBigUint(raw, 1);
      if (reserve0 === undefined || reserve1 === undefined) return { status: "rejected", reasonCode: "malformed_reserves", retryable: false, capabilities };
      const reserveState = { reserve0Raw: reserve0.toString(), reserve1Raw: reserve1.toString() };
      if (!capabilities.spotPriceReadable) return { status: "complete", reasonCode: "exact_reserves_only", capabilities, ...reserveState };
      const price = rationalPrice(reserve1, reserve0, decimals0, decimals1);
      return price
        ? { status: "complete", reasonCode: "onchain_reserve_spot", capabilities, ...reserveState, ...price }
        : { status: "rejected", reasonCode: "zero_or_invalid_reserves", retryable: false, capabilities, ...reserveState };
    }
    if (capabilities.spotPriceReadable) {
      const [slot0Raw, liquidityRaw] = await rpc.batch([
        { method: "eth_call", params: [{ to: pool.poolAddress, data: SELECTOR.slot0 }, tag] },
        { method: "eth_call", params: [{ to: pool.poolAddress, data: SELECTOR.liquidity }, tag] }
      ], options);
      const sqrtPriceX96 = decodeAbiBigUint(slot0Raw, 0);
      const inRangeLiquidity = decodeAbiBigUint(liquidityRaw, 0);
      if (!sqrtPriceX96 || sqrtPriceX96 <= 0n) return { status: "rejected", reasonCode: "invalid_slot0", retryable: false, capabilities };
      const price = rationalPrice(sqrtPriceX96 * sqrtPriceX96, 2n ** 192n, decimals0, decimals1);
      return price
        ? { status: "complete", reasonCode: "onchain_slot0_spot", capabilities, sqrtPriceX96: sqrtPriceX96.toString(), inRangeLiquidityRaw: inRangeLiquidity?.toString(), liquidityUsd: undefined, ...price }
        : { status: "rejected", reasonCode: "invalid_slot0_price", retryable: false, capabilities };
    }
    return { status: "unsupported", reasonCode: "provider_enrichment_required", capabilities };
  } catch {
    return { status: "retryable", reasonCode: "pool_state_read_failed", retryable: true, capabilities };
  }
}

export function decodeAbiText(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]*$/i.test(value)) return undefined;
  const hex = value.slice(2);
  if (hex.length === 64) return sanitizeText(bytesFromHex(hex));
  if (hex.length < 128) return undefined;
  const offset = Number.parseInt(hex.slice(0, 64), 16) * 2;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + 64 > hex.length) return undefined;
  const length = Number.parseInt(hex.slice(offset, offset + 64), 16);
  if (!Number.isSafeInteger(length) || length < 0 || length > 256) return undefined;
  const start = offset + 64;
  const end = start + length * 2;
  if (end > hex.length) return undefined;
  return sanitizeText(bytesFromHex(hex.slice(start, end)));
}

export function decodeAbiUint(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) return undefined;
  const parsed = Number.parseInt(value, 16);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function decodeAbiAddress(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) return undefined;
  const address = `0x${value.slice(-40)}`.toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(address) ? address : undefined;
}

export function decodeAbiBigUint(value, wordIndex = 0) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return undefined;
  const start = 2 + wordIndex * 64;
  const word = value.slice(start, start + 64);
  if (!/^[0-9a-f]{64}$/i.test(word)) return undefined;
  try { return BigInt(`0x${word}`); } catch { return undefined; }
}

export function hexToSafeNumber(value) {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("Invalid RPC hex number");
  const parsed = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(parsed)) throw new Error("RPC number exceeds safe integer range");
  return parsed;
}

export function toHex(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Block number must be a non-negative safe integer");
  return `0x${value.toString(16)}`;
}

function rationalPrice(rawNumerator, rawDenominator, decimals0, decimals1) {
  if (rawNumerator <= 0n || rawDenominator <= 0n) return undefined;
  const numerator = rawNumerator * 10n ** BigInt(decimals0);
  const denominator = rawDenominator * 10n ** BigInt(decimals1);
  const value = rationalToNumber(numerator, denominator);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return {
    priceToken1PerToken0: value,
    rawPriceRatio: { numerator: numerator.toString(), denominator: denominator.toString() }
  };
}

function rationalToNumber(numerator, denominator) {
  const scale = 10n ** 30n;
  const scaled = numerator * scale / denominator;
  return Number(scaled.toString()) / 1e30;
}

function validDecimals(value) { return validDecimalsValue(value); }
function validDecimalsValue(value) { return Number.isInteger(value) && value >= 0 && value <= 255; }
function blockTag(value) { return typeof value === "number" ? toHex(value) : value; }
function normalizeAddress(value) { const normalized = typeof value === "string" ? value.toLowerCase() : ""; return /^0x[0-9a-f]{40}$/.test(normalized) ? normalized : undefined; }

function bytesFromHex(hex) {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function sanitizeText(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return text ? text.slice(0, 64) : undefined;
  } catch { return undefined; }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class JsonRpcRequestError extends Error {
  constructor(reasonCode, { retryable = true, rpcCode } = {}) {
    super(reasonCode);
    this.name = "JsonRpcRequestError";
    this.reasonCode = reasonCode;
    this.retryable = retryable;
    this.rpcCode = rpcCode;
  }
}

function classifyRpcError(error) {
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("proxy") || message.includes("implementation")) return "rpc_proxy_mismatch";
  if (message.includes("revert") || error?.code === 3) return "rpc_execution_reverted";
  if (message.includes("timeout")) return "rpc_timeout";
  if (error?.code === -32602) return "rpc_invalid_params";
  return `rpc_error_${Number.isInteger(error?.code) ? error.code : "unknown"}`;
}

function metadataDecimalsFailure(outcome, value) {
  if (outcome?.ok) return value === undefined ? "decimals_malformed_abi" : undefined;
  const reasons = {
    rpc_execution_reverted: "decimals_call_reverted",
    rpc_timeout: "decimals_timeout",
    rpc_empty_response: "decimals_empty_response",
    rpc_malformed_response: "decimals_malformed_rpc",
    rpc_proxy_mismatch: "proxy_mismatch"
  };
  return reasons[outcome?.reasonCode] ?? outcome?.reasonCode ?? "decimals_read_failed";
}

function isRetryableRpcError(error) {
  return ![3, -32600, -32601, -32602].includes(error?.code);
}

function classifyTransportError(error) {
  if (typeof error?.reasonCode === "string") return error.reasonCode;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "rpc_timeout";
  if (error instanceof SyntaxError) return "rpc_malformed_json";
  return "rpc_transport_failure";
}
