const SELECTOR = Object.freeze({
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  factory: "0xc45a0155"
});

export class JsonRpcClient {
  constructor(url, { timeoutMs = 12_000, retries = 3 } = {}) {
    if (!/^https?:\/\//i.test(url ?? "")) throw new Error("A valid HTTP RPC URL is required");
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.nextId = 1;
  }

  async request(method, params = []) {
    return (await this.batch([{ method, params }]))[0];
  }

  async batch(calls) {
    if (!calls.length) return [];
    const requests = calls.map((call) => ({ jsonrpc: "2.0", id: this.nextId++, method: call.method, params: call.params ?? [] }));
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        const response = await fetch(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(requests),
          signal: AbortSignal.timeout(this.timeoutMs)
        });
        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
        const payload = await response.json();
        const rows = Array.isArray(payload) ? payload : [payload];
        const byId = new Map(rows.map((row) => [row.id, row]));
        return requests.map((request) => {
          const row = byId.get(request.id);
          if (!row) throw new Error(`RPC response missing for ${request.method}`);
          if (row.error) throw new Error(`RPC ${request.method} failed (${row.error.code})`);
          return row.result;
        });
      } catch (error) {
        if (attempt === this.retries) throw error;
        await delay(Math.min(2_000, 250 * 2 ** attempt));
      }
    }
    throw new Error("RPC retry exhausted");
  }

  async blockNumber() {
    return hexToSafeNumber(await this.request("eth_blockNumber"));
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

  async getBlock(blockNumber) {
    return this.request("eth_getBlockByNumber", [toHex(blockNumber), false]);
  }

  async getCode(address, block = "latest") {
    return this.request("eth_getCode", [address, typeof block === "number" ? toHex(block) : block]);
  }

  async call(address, data, block = "latest") {
    return this.request("eth_call", [{ to: address, data }, typeof block === "number" ? toHex(block) : block]);
  }
}

export async function enrichTokenMetadata(rpc, tokenAddress, blockNumber, now = new Date()) {
  const fallback = {
    address: tokenAddress,
    name: undefined,
    symbol: undefined,
    decimals: undefined,
    status: "unavailable",
    codeExists: false,
    observedAt: now.toISOString(),
    blockNumber
  };
  try {
    const code = await rpc.getCode(tokenAddress, blockNumber);
    if (!code || code === "0x") return fallback;
    const calls = [SELECTOR.name, SELECTOR.symbol, SELECTOR.decimals].map((data) => ({ method: "eth_call", params: [{ to: tokenAddress, data }, toHex(blockNumber)] }));
    const results = await rpc.batch(calls.map((call) => call));
    const name = decodeAbiText(results[0]);
    const symbol = decodeAbiText(results[1]);
    const decimals = decodeAbiUint(results[2]);
    const validDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : undefined;
    const complete = Boolean(name && symbol && validDecimals !== undefined);
    return {
      ...fallback,
      name,
      symbol,
      decimals: validDecimals,
      codeExists: true,
      status: complete ? "complete" : "partial"
    };
  } catch {
    return { ...fallback, codeExists: true, status: "partial" };
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
