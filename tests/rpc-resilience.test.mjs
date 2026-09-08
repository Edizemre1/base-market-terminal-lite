import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { JsonRpcClient, verifyPoolBindings } from "../collector/rpc.mjs";
import { RpcTransportPool, configuredRpcEndpoints } from "../collector/rpc-transport.mjs";
import { BoundedSemaphore, withDeadline, abortableDelay } from "../collector/async-control.mjs";

const hash = (number) => `0x${number.toString(16).padStart(64, "0")}`;
const call = { method: "eth_call", params: [{ to: `0x${"1".repeat(40)}`, data: "0x313ce567" }, "0x62"] };

function fixture(behavior = () => undefined, options = {}) {
  let clock = 1_800_000_000_000;
  const wires = [];
  const pool = new RpcTransportPool([{ label: "primary", url: "https://primary.invalid/private-key" }, { label: "configured-1", url: "https://fallback.invalid/secret" }], {
    now: () => clock, random: () => 0, delayImpl: async (ms) => { clock += ms; }, timeoutMs: 30,
    fetchImpl: async (url, init) => {
      const endpoint = url.includes("primary") ? "primary" : "fallback";
      const requests = JSON.parse(init.body);
      wires.push({ endpoint, requests });
      const values = [];
      for (const request of requests) {
        const custom = await behavior(endpoint, request, { clock, signal: init.signal });
        if (custom?.http) return { ok: false, status: custom.http };
        if (custom?.malformed) return { ok: true, json: async () => custom.malformed };
        let result = custom?.value;
        if (result === undefined) {
          if (request.method === "eth_chainId") result = "0x2105";
          if (request.method === "eth_blockNumber") result = "0x64";
          if (request.method === "eth_getBlockByNumber") {
            const number = request.params[0] === "latest" ? 100 : Number.parseInt(request.params[0], 16);
            result = { number: `0x${number.toString(16)}`, hash: hash(number), timestamp: `0x${Math.floor(clock / 1_000).toString(16)}` };
          }
          if (request.method === "eth_call") result = `0x${"0".repeat(62)}12`;
          if (request.method === "eth_getCode") result = "0x01";
          if (request.method === "eth_getLogs") result = [];
        }
        values.push({ jsonrpc: "2.0", id: request.id, ...(custom?.error ? { error: custom.error } : { result }) });
      }
      return { ok: true, json: async () => values };
    }, ...options
  });
  pool.setContinuity({ number: 50, hash: hash(50) });
  return { pool, client: pool.client(), wires, advance: (ms) => { clock += ms; }, now: () => clock };
}

test("existing plural Base endpoint configuration is included without leaking labels", () => {
  const endpoints = configuredRpcEndpoints({ BASE_RPC_URL: "https://mainnet.base.org", BASE_RPC_URLS: "https://mainnet.base.org,https://configured-a.invalid/key https://configured-b.invalid/key" });
  assert.equal(endpoints.length, 4);
  assert.equal(endpoints.filter((row) => row.url === "https://mainnet.base.org").length, 1);
  assert(endpoints.some((row) => row.url === "https://configured-a.invalid/key"));
  assert(endpoints.some((row) => row.url === "https://configured-b.invalid/key"));
  assert(endpoints.every((row) => !row.label.includes("key")));
});

test("-32016 is provider-retryable even when its raw message says revert", async () => {
  const rpc = new JsonRpcClient("https://example.invalid", { retries: 0, fetchImpl: async (_, init) => ({ ok: true, json: async () => JSON.parse(init.body).map(({ id }) => ({ jsonrpc: "2.0", id, error: { code: -32016, message: "execution reverted upstream secret" } })) }) });
  const [outcome] = await rpc.batchOutcomes([call]);
  assert.equal(outcome.reasonCode, "rpc_error_-32016"); assert.equal(outcome.retryable, true);
  assert.equal(JSON.stringify(outcome).includes("secret"), false);
});

for (const failure of [429, 503, -32016, "timeout"]) test(`bounded source-correct fallback for ${failure}`, async () => {
  const f = fixture(async (endpoint, request) => {
    if (endpoint !== "primary" || request.method !== "eth_call") return;
    if (failure === "timeout") return new Promise(() => {});
    return failure > 0 ? { http: failure } : { error: { code: failure, message: "upstream unavailable" } };
  });
  const [outcome] = await f.client.batchOutcomes([call], { blockProof: { number: 98, hash: hash(98) } });
  assert.equal(outcome.ok, true); assert.equal(outcome.endpointLabel, "configured-1");
  assert.equal(f.pool.snapshot().failovers, 1);
  assert.equal(f.wires.filter((row) => row.endpoint === "primary" && row.requests.some((r) => r.method === "eth_call")).length, 1);
  assert(f.wires.some((row) => row.endpoint === "fallback" && row.requests.some((r) => r.method === "eth_getBlockByNumber" && r.params[0] === "0x62")));
  assert.equal(JSON.stringify(f.pool.snapshot()).includes("https"), false);
});

for (const kind of ["wrong_chain", "hash_conflict", "malformed"]) test(`${kind} quarantines endpoint, not pool`, async () => {
  const f = fixture((endpoint, request) => {
    if (endpoint !== "primary") return;
    if (kind === "wrong_chain" && request.method === "eth_chainId") return { value: "0x1" };
    if (kind === "hash_conflict" && request.method === "eth_getBlockByNumber" && request.params[0] === "0x32") return { value: { number: "0x32", hash: hash(51), timestamp: "0x6b49d200" } };
    if (kind === "malformed" && request.method === "eth_call") return { malformed: [{ id: request.id, jsonrpc: "2.0", result: "0x01" }, { id: request.id, jsonrpc: "2.0", result: "0x02" }] };
  });
  assert.equal((await f.client.batchOutcomes([call]))[0].ok, true);
  assert.equal(f.pool.snapshot().endpoints[0].status, "quarantined");
});

test("cursor movement during validation is retryable, not a false block quarantine", async () => {
  let moved = false;
  const f = fixture((endpoint, request) => {
    if (!moved && endpoint === "primary" && request.method === "eth_getBlockByNumber" && request.params[0] === "0x32") {
      moved = true; f.pool.setContinuity({ number: 51, hash: hash(51) });
    }
  });
  const [outcome] = await f.client.batchOutcomes([call]);
  assert.equal(outcome.ok, true);
  assert.notEqual(f.pool.snapshot().endpoints[0].status, "quarantined");
  assert.equal(f.pool.snapshot().endpoints[0].methods.eth_call.lastError.reasonCode, "rpc_cursor_changed_during_validation");
});

test("a response completing after endpoint quarantine cannot publish success", async () => {
  const f = fixture((endpoint, request) => {
    if (endpoint === "primary" && request.method === "eth_call") Object.assign(f.pool.endpoints[0], { status: "quarantined", reasonCode: "rpc_malformed_result" });
  });
  const [outcome] = await f.client.batchOutcomes([call]);
  assert.equal(outcome.ok, true); assert.equal(outcome.endpointLabel, "configured-1");
  assert.equal(f.pool.snapshot().endpoints[0].status, "quarantined");
  assert.equal(f.pool.snapshot().endpoints[0].methods.eth_call.success, 0);
});

test("exhausted denied endpoints remain provider-retryable and cannot reject a factory pool", async () => {
  const f = fixture((_endpoint, request) => request.method === "eth_getCode" ? { http: 403 } : undefined);
  const address = `0x${"1".repeat(40)}`;
  const [binding] = await verifyPoolBindings(f.client, [{ poolAddress: address, token0: address, token1: `0x${"2".repeat(40)}`, factoryAddress: `0x${"3".repeat(40)}`, blockNumber: 98 }]);
  assert.equal(binding.ok, false);
  assert.equal(binding.retryable, true, "endpoint denial must block the window, never drop its pool event");
  assert.match(binding.reason, /^rpc_/);
  assert(f.pool.snapshot().endpoints.every((endpoint) => endpoint.methods.eth_getCode.state === "open"));
});

test("behind fallback is ineligible for the requested exact block", async () => {
  const f = fixture((endpoint, request) => {
    if (endpoint === "primary" && request.method === "eth_call") return { http: 503 };
    if (endpoint === "fallback" && request.method === "eth_getBlockByNumber" && request.params[0] === "0x62") return { value: null };
  });
  const [outcome] = await f.client.batchOutcomes([call], { blockProof: { number: 98, hash: hash(98) } });
  assert.equal(outcome.ok, false); assert.equal(outcome.reasonCode, "rpc_endpoint_behind");
  assert(!f.wires.some((row) => row.endpoint === "fallback" && row.requests.some((r) => r.method === "eth_call")));
});

test("exact block-tag mismatch is rejected before any network call", async () => {
  const f = fixture();
  await assert.rejects(f.client.batchOutcomes([call], { blockProof: { number: 99, hash: hash(99) } }), /rpc_exact_block_tag_mismatch/);
  assert.equal(f.wires.length, 0);
});

test("partial batch failover repeats the whole batch and never mixes sources", async () => {
  const f = fixture((endpoint, request) => request.method === "eth_call" ? endpoint === "primary" && request.params[0].data === "0x00" ? { error: { code: -32016 } } : { value: endpoint === "primary" ? "0x11" : "0x22" } : undefined);
  const rows = await f.client.batchOutcomes([call, { ...call, params: [{ ...call.params[0], data: "0x00" }, "0x62"] }], { blockProof: { number: 98, hash: hash(98) } });
  assert.deepEqual(rows.map((row) => row.value), ["0x22", "0x22"]);
  assert(rows.every((row) => row.endpointLabel === "configured-1"));
});

test("method circuit opens, skips retries during cooldown and recovers half-open", async () => {
  let fail = true;
  const f = fixture((endpoint, request) => endpoint === "primary" && request.method === "eth_call" && fail ? { http: 429 } : undefined);
  await f.client.batchOutcomes([call]);
  const count = f.wires.filter((row) => row.endpoint === "primary").length;
  await f.client.batchOutcomes([call]);
  assert.equal(f.wires.filter((row) => row.endpoint === "primary").length, count);
  assert.equal(await f.client.blockNumber(), 100); // unrelated method remains available
  fail = false; f.advance(60_000);
  assert.equal((await f.client.batchOutcomes([call]))[0].endpointLabel, "primary");
  const method = f.pool.snapshot().endpoints[0].methods.eth_call;
  assert.equal(method.state, "closed"); assert(method.lastError.recoveredAt);
});

test("deadline settles abort-ignoring fetch and removes caller listeners", async () => {
  const parent = new AbortController();
  for (let i = 0; i < 20; i += 1) await assert.rejects(withDeadline(() => new Promise(() => {}), 1, { signal: parent.signal }), /rpc_timeout/);
  assert.equal(getEventListeners(parent.signal, "abort").length, 0);
  const abort = new AbortController(); abort.abort(new Error("cancelled"));
  await assert.rejects(withDeadline(() => assert.fail("must not start"), 10, { signal: abort.signal }), /cancelled/);
});

test("bounded semaphore removes cancelled waiters and releases exactly once", async () => {
  const gate = new BoundedSemaphore(1, 2);
  const release = await gate.acquire();
  const controller = new AbortController();
  const waiting = gate.acquire(controller.signal);
  controller.abort(new Error("cancelled"));
  await assert.rejects(waiting, /cancelled/);
  assert.equal(gate.waiters.length, 0); assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  release(); release(); assert.equal(gate.active, 0);
});

test("parallel callers respect global=2 / endpoint=1 and bounded pacing", async () => {
  let active = 0, peak = 0;
  const f = fixture(async () => { active += 1; peak = Math.max(peak, active); await abortableDelay(1); active -= 1; });
  await Promise.all(Array.from({ length: 6 }, () => f.client.blockNumber()));
  assert(peak <= 1); assert(f.pool.snapshot().peakConcurrency <= 2);
  assert.equal(f.pool.snapshot().active, 0); assert.equal(f.pool.snapshot().queued, 0);
});

test("endpoint configuration is bounded, deduplicated and labels never expose URLs", () => {
  const endpoints = configuredRpcEndpoints({ BASE_RPC_HTTP_URL: "https://mainnet.base.org", BASE_RPC_URL: "https://other.invalid/key" });
  assert.equal(endpoints.filter((row) => row.url === "https://mainnet.base.org").length, 1);
  assert(endpoints.length <= 4); assert(endpoints.some((row) => row.label === "base-public-fallback"));
});
