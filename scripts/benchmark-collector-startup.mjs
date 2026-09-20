import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { getPriority, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { serialize as v8Serialize, getHeapStatistics } from "node:v8";
import { isMainThread, resourceLimits, threadId } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DurableDiscoveryStore, createIntegrity, initialState, readStoreSnapshotSync } from "../collector/store.mjs";
import { createJournalCursor, replayJournalChunk } from "../collector/journal.mjs";
import { OnchainDiscoveryCollector } from "../collector/service.mjs";

const TARGET_FIXTURE_BYTES = 25_200_033;
const FIXTURE_POOLS = 2_000;
const FIXTURE_EVENTS = 5_000;
const FIXTURE_OPPORTUNITIES = 2_000;
const FIXTURE_LARGE_RECORDS = 128;
const FIXTURE_HEAD = 51_358_552;
const FIXTURE_CURSOR = 51_358_537;
const ACCEPTANCE_HEAD = 51_564_266;
const MAX_READER_LATENCY_MS = 15_000;
const script = fileURLToPath(import.meta.url);

const mode = process.argv[2];
if (mode === "--generate-fixture") await generateFixture(required(3), required(5));
else if (mode === "--baseline") await runBaseline(required(3), required(5));
else if (mode === "--acceptance") await runAcceptance(required(3), required(5));
else if (mode === "--clone-storm") cloneStorm(required(3));
else if (mode === "--reader-server") await readerServer(required(3), required(4));
else throw new Error("collector_startup_benchmark_mode_required");

async function generateFixture(file, output) {
  const state = realisticState();
  let serialized = serializeState(state);
  const remaining = TARGET_FIXTURE_BYTES - Buffer.byteLength(serialized);
  if (remaining < 0) throw new Error(`fixture_base_too_large:${Buffer.byteLength(serialized)}`);
  distributePadding(state, remaining);
  state.integrity = createIntegrity(state);
  serialized = serializeState(state);
  if (Buffer.byteLength(serialized) !== TARGET_FIXTURE_BYTES) throw new Error(`fixture_size_mismatch:${Buffer.byteLength(serialized)}`);
  if (/private[_-]?key|secret|credential|https?:\/\//i.test(serialized)) throw new Error("fixture_sensitive_material_detected");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, serialized, { encoding: "utf8", mode: 0o640 });
  const report = {
    schemaVersion: 1,
    kind: "secrets_free_production_shape",
    bytes: statSync(file).size,
    sha256: sha256(serialized),
    v8SerializedBytes: v8Serialize(state).byteLength,
    counts: {
      pools: Object.keys(state.pools).length,
      events: Object.keys(state.events).length,
      opportunities: state.opportunities.length,
      tokenMetadata: Object.keys(state.tokenMetadata).length,
      onchainQueueBeforeInitialization: state.onchainQueue.length,
      enrichmentQueueBeforeInitialization: state.enrichmentQueue.length,
      largeRecords: FIXTURE_LARGE_RECORDS
    },
    areaBytes: Object.fromEntries(["pools", "events", "opportunities", "tokenMetadata", "health", "history", "reconciliation"].map((key) => [key, Buffer.byteLength(JSON.stringify(state[key]))]))
  };
  writeReport(output, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

async function runBaseline(fixture, output) {
  assertLinuxEnvelope();
  const child = spawnSync(process.execPath, ["--max-old-space-size=259", ...process.execArgv, script, "--clone-storm", fixture], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: "" },
    maxBuffer: 2 * 1_024 * 1_024
  });
  const progress = String(child.stdout).trim().split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const stderr = String(child.stderr);
  const report = {
    schemaVersion: 1,
    workload: "pre_fix_full_state_clone_storm",
    fixtureBytes: statSync(fixture).size,
    reproduced: child.signal === "SIGABRT" && /heap out of memory/i.test(stderr) && /node::worker::Message::Deserialize/.test(stderr),
    exitCode: child.status,
    signal: child.signal,
    completedClones: progress.filter((row) => row.event === "clone_complete").length,
    isolate: progress.find((row) => row.event === "clone_storm_start")?.isolate,
    failureEvidence: {
      heapOutOfMemory: /heap out of memory/i.test(stderr),
      messageDeserialize: /node::worker::Message::Deserialize/.test(stderr),
      workerApiUsed: false
    },
    cgroup: readCgroupLimits()
  };
  if (!report.reproduced) throw new Error(`legacy_clone_storm_not_reproduced:${JSON.stringify(report)}`);
  writeReport(output, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function cloneStorm(fixture) {
  const state = JSON.parse(readFileSync(fixture, "utf8"));
  process.stdout.write(`${JSON.stringify({ event: "clone_storm_start", fixtureBytes: statSync(fixture).size, isolate: isolateContract(), memory: memorySample() })}\n`);
  const held = [state];
  for (let index = 1; index <= 8; index += 1) {
    held.push(structuredClone(state));
    process.stdout.write(`${JSON.stringify({ event: "clone_complete", index, memory: memorySample() })}\n`);
  }
  throw new Error("legacy_clone_storm_unexpectedly_survived");
}

async function runAcceptance(fixture, output) {
  const envelope = assertLinuxEnvelope();
  const root = mkdtempSync(path.join(tmpdir(), "base-startup-acceptance-"));
  const storeDirectory = path.join(root, "store");
  const recoveryDirectory = path.join(root, "recovery");
  const readerReportPath = path.join(root, "reader.json");
  mkdirSync(storeDirectory, { recursive: true });
  linkSync(fixture, path.join(storeDirectory, "state.json"));
  const ioBefore = readCgroupIo();
  const metricsLog = [];
  let reader;
  let polling = false;
  let pollPromise = Promise.resolve();
  const readerRequests = [];
  try {
    const transport = fakeTransport();
    const rpc = fakeRpc();
    const collector = new OnchainDiscoveryCollector({
      storeDirectory,
      transport,
      rpcClient: rpc,
      discoveryRpcClient: rpc,
      stateRpcClient: rpc,
      anchorRpcClient: rpc,
      providerClient: fakeProvider(),
      anchorProviderClient: fakeProvider(),
      bootstrapBlocks: 2_000,
      websocketUrl: undefined
    });
    collector.store = new DurableDiscoveryStore(storeDirectory, {
      checkpointIntervalMs: 24 * 60 * 60_000,
      checkpointTransactionLimit: 3,
      maxPendingTransactions: 4,
      metricsLogIntervalMs: 10_000,
      metricsLogger(line) {
        try { metricsLog.push(JSON.parse(line)); } catch { /* bounded metrics only */ }
      }
    });

    const startupStarted = process.hrtime.bigint();
    const initialized = await collector.open();
    const initializationMs = elapsedMs(startupStarted);
    assertEqual(initialized.onchainQueue?.length, 512, "onchain_queue_not_full");
    assertEqual(initialized.enrichmentQueue?.length, 512, "enrichment_queue_not_full");

    reader = spawn(process.execPath, [...process.execArgv, script, "--reader-server", storeDirectory, readerReportPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NODE_OPTIONS: "" }
    });
    const port = await waitForReady(reader);
    const readerUrl = `http://127.0.0.1:${port}/snapshot`;
    polling = true;
    pollPromise = (async () => {
      while (polling) {
        const started = process.hrtime.bigint();
        try {
          const response = await fetch(readerUrl, { signal: AbortSignal.timeout(MAX_READER_LATENCY_MS) });
          const body = await response.json();
          readerRequests.push({ ok: response.ok && body.ok, ms: elapsedMs(started), cursor: body.cursor, currentHead: body.currentHead, sequence: body.sequence });
        } catch (error) {
          readerRequests.push({ ok: false, ms: elapsedMs(started), reason: error?.name ?? "reader_failure" });
        }
        await delay(250);
      }
    })();

    await waitForReaderSuccess(readerRequests);
    await collector.reconcileHead();
    mkdirSync(recoveryDirectory, { recursive: true });
    linkSync(path.join(storeDirectory, "state.json"), path.join(recoveryDirectory, "state.json"));
    copyFileSync(path.join(storeDirectory, "wal.ndjson"), path.join(recoveryDirectory, "wal.ndjson"));
    const beforeCursor = minimumCursor(collector.store.readView());
    await collector.scanOnce();
    const afterCursor = minimumCursor(collector.store.readView());
    if (!(afterCursor > beforeCursor)) throw new Error(`cursor_did_not_progress:${beforeCursor}:${afterCursor}`);
    await collector.store.flush();
    await waitForReaderCursor(readerRequests, afterCursor);

    const statusStateBefore = sha256(readFileSync(path.join(storeDirectory, "state.json")));
    const statusWalBefore = sha256(readFileSync(path.join(storeDirectory, "wal.ndjson")));
    const statusWriteBefore = readProcessWriteBytes();
    for (let index = 0; index < 16; index += 1) {
      await collector.store.updateRuntimeStatus("acceptance-status-only", { loops: { head: { phase: "idle", sample: index } } });
    }
    const statusWriteBytes = Math.max(0, readProcessWriteBytes() - statusWriteBefore);
    const statusStateAfter = sha256(readFileSync(path.join(storeDirectory, "state.json")));
    const statusWalAfter = sha256(readFileSync(path.join(storeDirectory, "wal.ndjson")));
    if (statusWriteBytes !== 0 || statusStateBefore !== statusStateAfter || statusWalBefore !== statusWalAfter) throw new Error("status_only_write_regression");

    const recovered = readStoreSnapshotSync(recoveryDirectory);
    if (!recovered.ok || recovered.state.currentHead !== ACCEPTANCE_HEAD) throw new Error("crash_copy_recovery_failed");
    const recoveryCursor = createJournalCursor(JSON.parse(readFileSync(path.join(recoveryDirectory, "state.json"), "utf8")));
    const recoveryReplay = replayJournalChunk(recoveryCursor, readFileSync(path.join(recoveryDirectory, "wal.ndjson")));
    const recoveredSequence = recoveryCursor.sequence;
    if (recoveryReplay.applied < 2 || recoveryReplay.incompleteBytes !== 0) throw new Error(`crash_replay_incomplete:${recoveryReplay.applied}:${recoveryReplay.incompleteBytes}`);
    const finalSnapshot = readStoreSnapshotSync(storeDirectory);
    if (!finalSnapshot.ok || minimumCursor(finalSnapshot.state) !== afterCursor) throw new Error("checkpoint_snapshot_invalid");

    polling = false;
    await pollPromise;
    reader.kill("SIGTERM");
    await once(reader, "exit");
    reader = undefined;
    const readerReport = JSON.parse(readFileSync(readerReportPath, "utf8"));
    const metrics = collector.store.getMetrics();
    await collector.close();
    const ioAfter = readCgroupIo();
    const cgroupWriteBytes = Math.max(0, ioAfter.writeBytes - ioBefore.writeBytes);
    const maxReaderMs = Math.max(0, ...readerRequests.map((row) => row.ms));
    const failedReaderRequests = readerRequests.filter((row) => !row.ok).length;
    if (failedReaderRequests || maxReaderMs >= MAX_READER_LATENCY_MS) throw new Error(`reader_timeout_or_failure:${failedReaderRequests}:${maxReaderMs}`);
    if (metrics.peakHeapUsed >= metrics.runtime.heapLimitBytes * 0.85) throw new Error(`heap_margin_insufficient:${metrics.peakHeapUsed}:${metrics.runtime.heapLimitBytes}`);
    if (cgroupWriteBytes > 128 * 1_024 * 1_024) throw new Error(`write_budget_exceeded:${cgroupWriteBytes}`);
    if (metrics.queuePeak > 4 || metrics.resourcePhases.transaction_complete?.peakHeapUsed > metrics.runtime.heapLimitBytes * 0.85) throw new Error("memory_or_inflight_bound_exceeded");

    const report = {
      schemaVersion: 1,
      sourceSha: process.env.SOURCE_SHA || process.env.GITHUB_SHA || "local-unpinned",
      workload: {
        kind: "production_shape_startup_commit_checkpoint_recovery_reader",
        fixtureBytes: statSync(fixture).size,
        pools: FIXTURE_POOLS,
        events: FIXTURE_EVENTS,
        opportunities: FIXTURE_OPPORTUNITIES,
        initialOnchainQueue: initialized.onchainQueue.length,
        initialEnrichmentQueue: initialized.enrichmentQueue.length
      },
      envelope,
      isolate: metrics.runtime,
      initialization: {
        wallMs: initializationMs,
        deltaBytes: metrics.reasons["initialize-enrichment-state"]?.logicalBytes ?? 0,
        patchOperations: metrics.reasons["initialize-enrichment-state"]?.patchOperations ?? 0
      },
      memory: {
        peakHeapUsed: metrics.peakHeapUsed,
        heapLimitBytes: metrics.runtime.heapLimitBytes,
        peakRss: metrics.peakRss,
        peakExternal: metrics.peakExternal,
        peakArrayBuffers: metrics.peakArrayBuffers,
        peakCgroupMemory: Math.max(metrics.peakCgroupMemory, readCgroupMemoryPeak()),
        structuredCloneCalls: metrics.structuredCloneCalls,
        maxCloneSourceBytes: metrics.maxCloneSourceBytes,
        maxObservedMessageBytes: metrics.maxObservedMessageBytes,
        phases: metrics.resourcePhases
      },
      persistence: {
        transactions: metrics.transactions,
        journalBytes: metrics.journalBytes,
        checkpointBytes: metrics.checkpointBytes,
        checkpointWallMs: metrics.checkpointMs,
        checkpointCpuMs: metrics.checkpointCpuMs,
        checkpointIntegrityMs: metrics.checkpointIntegrityMs,
        checkpointSerializeMs: metrics.checkpointSerializeMs,
        checkpointWriteMs: metrics.checkpointWriteMs,
        checkpointWriteCpuMs: metrics.checkpointWriteCpuMs,
        checkpointDiskWaitMs: metrics.checkpointDiskWaitMs,
        cgroupWriteBytes,
        statusOnlyPhysicalWriteBytes: statusWriteBytes,
        recoveryOk: recovered.ok,
        recoveryAppliedTransactions: recoveryReplay.applied,
        recoveryIncompleteBytes: recoveryReplay.incompleteBytes,
        recoveredSequence,
        finalWalBytes: statSync(path.join(storeDirectory, "wal.ndjson")).size
      },
      progress: { beforeCursor, afterCursor, currentHead: finalSnapshot.state.currentHead, confirmedHead: finalSnapshot.state.confirmedHead },
      reader: {
        requests: readerRequests.length,
        failures: failedReaderRequests,
        maxLatencyMs: maxReaderMs,
        observedProgress: readerRequests.some((row) => row.cursor >= afterCursor),
        metrics: readerReport.metrics,
        peakRss: readerReport.peakRss,
        peakHeapUsed: readerReport.peakHeapUsed
      },
      bounds: { transactionQueuePeak: metrics.queuePeak, backpressureWaits: metrics.backpressureWaits, finalOnchainQueue: finalSnapshot.state.onchainQueue.length, finalEnrichmentQueue: finalSnapshot.state.enrichmentQueue.length },
      metricsLogLines: metricsLog.length
    };
    writeReport(output, report);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    polling = false;
    await pollPromise.catch(() => {});
    if (reader && reader.exitCode === null && reader.signalCode === null) {
      reader.kill("SIGTERM");
      await once(reader, "exit").catch(() => {});
    }
    rmSync(root, { recursive: true, force: true });
  }
}

async function readerServer(storeDirectory, reportPath) {
  process.env.ONCHAIN_STORE_PATH = storeDirectory;
  const { createServer } = await import("node:http");
  const reader = await import(pathToFileURL(path.resolve("src/lib/base-terminal/onchainDiscovery.ts")));
  reader.resetOnchainStoreReadCacheForTests();
  let peakRss = 0;
  let peakHeapUsed = 0;
  let requests = 0;
  let failures = 0;
  let maxLatencyMs = 0;
  const server = createServer((request, response) => {
    const started = process.hrtime.bigint();
    requests += 1;
    const result = reader.readOnchainStoreSnapshot();
    const duration = elapsedMs(started);
    maxLatencyMs = Math.max(maxLatencyMs, duration);
    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss);
    peakHeapUsed = Math.max(peakHeapUsed, memory.heapUsed);
    failures += Number(!result.ok);
    response.writeHead(result.ok ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(result.ok ? { ok: true, cursor: minimumCursor(result.state), currentHead: result.state.currentHead, sequence: result.state.persistence?.appliedSequence ?? 0 } : result));
  });
  const finalize = () => {
    const report = { requests, failures, maxLatencyMs, peakRss, peakHeapUsed, metrics: reader.getOnchainStoreReadMetrics() };
    writeFileSync(reportPath, `${JSON.stringify(report)}\n`, { mode: 0o640 });
  };
  process.once("SIGTERM", () => server.close(() => { finalize(); process.exit(0); }));
  server.listen(0, "127.0.0.1", () => process.stdout.write(`READY ${server.address().port}\n`));
}

function realisticState() {
  const now = new Date("2026-09-20T12:00:00.000Z");
  const state = initialState(now);
  state.currentHead = FIXTURE_HEAD;
  state.confirmedHead = FIXTURE_HEAD - 2;
  for (const cursor of Object.values(state.cursors)) Object.assign(cursor, { blockNumber: FIXTURE_CURSOR, blockHash: hashHex(FIXTURE_CURSOR), updatedAt: now.toISOString() });
  for (let index = 0; index < FIXTURE_POOLS; index += 1) {
    const poolAddress = address(index + 10_000);
    const tokenSlot = index % 1_000;
    const token0 = address(tokenSlot * 2 + 1);
    const token1 = address(tokenSlot * 2 + 2);
    const poolKey = `uniswap-v2:${poolAddress}`;
    state.pools[poolKey] = {
      poolKey, poolAddress, chainId: 8453, dexId: "uniswap", factoryId: "uniswap-v2", factoryAddress: address(9_000), protocolVersion: "v2",
      token0, token1, status: "confirmed", verifiedSource: true, replay: false, orphaned: false,
      firstSeenAt: now.toISOString(), confirmedAt: now.toISOString(), observedAt: now.toISOString(), blockNumber: FIXTURE_CURSOR - index,
      transactionHash: hashHex(index + 1), logIndex: index % 64, providers: ["fixture_provider"], providerEnrichment: { status: index % 3 ? "pending" : "matched", attempts: index % 5 },
      providerLiquidityUsd: index % 3 ? undefined : 10_000 + index, volume24hUsd: index % 3 ? undefined : 1_000 + index,
      fixturePadding: ""
    };
    state.tokenMetadata[token0] = { address: token0, name: `Fixture Token ${tokenSlot * 2}`, symbol: `F${tokenSlot * 2}`, decimals: 18, status: "complete" };
    state.tokenMetadata[token1] = { address: token1, name: `Fixture Token ${tokenSlot * 2 + 1}`, symbol: `F${tokenSlot * 2 + 1}`, decimals: 18, status: "complete" };
  }
  const poolKeys = Object.keys(state.pools);
  for (let index = 0; index < FIXTURE_EVENTS; index += 1) {
    const poolKey = poolKeys[index % poolKeys.length];
    state.events[`fixture-event-${String(index).padStart(5, "0")}`] = { idempotencyKey: `fixture-event-${index}`, poolKey, status: "confirmed", replay: false, blockNumber: FIXTURE_CURSOR - index, transactionHash: hashHex(index + 50_000), logIndex: index % 64 };
  }
  for (let index = 0; index < FIXTURE_OPPORTUNITIES; index += 1) {
    const poolKey = poolKeys[index];
    state.opportunities.push({ id: `fixture-opportunity-${index}`, poolKeys: [poolKey], primaryPoolKey: poolKey, focusTokenAddress: state.pools[poolKey].token0, qualityBand: index % 4 === 0 ? "RANKED" : "DETECTED", ranked: index % 4 === 0, aggregate: { liquidityUsd: 10_000 + index, volumes: { h24: 1_000 + index }, transactions: { h24: { buys: index % 50, sells: index % 40 } } }, lifecycle: { detectedAt: now.toISOString() } });
  }
  state.history = Array.from({ length: 512 }, (_, index) => ({ kind: "fixture_history", at: now.toISOString(), poolKey: poolKeys[index % poolKeys.length] }));
  state.reconciliation = Array.from({ length: 128 }, (_, index) => ({ kind: "fixture_reconciliation", at: now.toISOString(), poolKey: poolKeys[index] }));
  state.health = { ...state.health, ready: false, backfillState: "catching_up", storeIntegrity: "ok", onchainQueueDepth: 0, enrichmentQueueDepth: 0 };
  state.integrity = { algorithm: "sha256", digest: "0".repeat(64) };
  return state;
}

function distributePadding(state, bytes) {
  const pools = Object.values(state.pools).slice(0, FIXTURE_LARGE_RECORDS);
  let remaining = bytes;
  for (let index = 0; index < pools.length; index += 1) {
    const slots = pools.length - index;
    const amount = Math.ceil(remaining / slots);
    if (amount > 480 * 1_024) throw new Error(`fixture_record_padding_too_large:${amount}`);
    pools[index].fixturePadding = "x".repeat(amount);
    remaining -= amount;
  }
  if (remaining !== 0) throw new Error(`fixture_padding_remaining:${remaining}`);
}

function fakeRpc() {
  return {
    async blockNumber() { return ACCEPTANCE_HEAD; },
    async getLogs() { return []; },
    async getBlock(number) { return { number: `0x${number.toString(16)}`, hash: hashHex(number), timestamp: `0x${Math.floor(Date.parse("2026-09-20T15:00:00.000Z") / 1_000).toString(16)}` }; },
    circuitSnapshot() { return { state: "closed" }; }
  };
}

function fakeTransport() {
  return { minimumHead: 0, setContinuity() {}, snapshot() { return { state: "closed" }; }, client() { return fakeRpc(); } };
}

function fakeProvider() {
  return { circuitSnapshot() { return { state: "closed" }; }, usageSnapshot() { return { requests: 0 }; } };
}

function assertLinuxEnvelope() {
  if (process.platform !== "linux") throw new Error("collector_startup_acceptance_requires_linux");
  const limits = readCgroupLimits();
  const [quota, period] = String(limits.cpuMax ?? "").split(/\s+/).map(Number);
  if (!(quota > 0) || !(period > 0) || quota / period > 0.25) throw new Error(`cpu_quota_not_enforced:${limits.cpuMax}`);
  if (Number(limits.memoryMax) !== 512 * 1_024 * 1_024) throw new Error(`memory_limit_not_enforced:${limits.memoryMax}`);
  if (!/(?:^|\s)50(?:$|\s)/.test(String(limits.ioWeight ?? ""))) throw new Error(`io_weight_not_enforced:${limits.ioWeight}`);
  if (!String(limits.ioMax ?? "").split(/\r?\n/).some((line) => /(?:^|\s)wbps=262144(?:\s|$)/.test(line))) throw new Error(`io_write_cap_not_enforced:${limits.ioMax}`);
  if (limits.nice !== 10) throw new Error(`nice_not_enforced:${limits.nice}`);
  if (!/^Max core file size\s+0\s+0\s+/m.test(readFileSync("/proc/self/limits", "utf8"))) throw new Error("core_limit_not_zero");
  return limits;
}

function readCgroupLimits() {
  const directory = cgroupDirectory();
  return {
    path: directory.slice("/sys/fs/cgroup".length) || "/",
    cpuMax: readOptional(path.join(directory, "cpu.max")),
    memoryMax: readOptional(path.join(directory, "memory.max")),
    ioWeight: readOptional(path.join(directory, "io.weight")),
    ioMax: readOptional(path.join(directory, "io.max")),
    nice: getPriority(),
    heapLimitBytes: getHeapStatistics().heap_size_limit
  };
}

function readCgroupIo() {
  const rows = readOptional(path.join(cgroupDirectory(), "io.stat"))?.split(/\r?\n/) ?? [];
  let readBytes = 0;
  let writeBytes = 0;
  for (const row of rows) for (const field of row.split(/\s+/)) {
    if (field.startsWith("rbytes=")) readBytes += Number(field.slice(7));
    if (field.startsWith("wbytes=")) writeBytes += Number(field.slice(7));
  }
  return { readBytes, writeBytes };
}

function readCgroupMemoryPeak() {
  return Number(readOptional(path.join(cgroupDirectory(), "memory.peak")) ?? 0);
}

function cgroupDirectory() {
  const membership = readFileSync("/proc/self/cgroup", "utf8").split(/\r?\n/).find((line) => line.startsWith("0::"));
  return path.resolve("/sys/fs/cgroup", `.${membership?.slice(3) || "/"}`);
}

function isolateContract() {
  return {
    isMainThread,
    threadId,
    node: process.version,
    heapLimitBytes: getHeapStatistics().heap_size_limit,
    execArgvFlags: process.execArgv.filter((entry) => entry.startsWith("--")).map((entry) => entry.split("=", 1)[0]),
    resourceLimits: {
      maxOldGenerationSizeMb: resourceLimits.maxOldGenerationSizeMb,
      maxYoungGenerationSizeMb: resourceLimits.maxYoungGenerationSizeMb,
      codeRangeSizeMb: resourceLimits.codeRangeSizeMb,
      stackSizeMb: resourceLimits.stackSizeMb
    }
  };
}

function memorySample() {
  const memory = process.memoryUsage();
  return { heapUsed: memory.heapUsed, external: memory.external, arrayBuffers: memory.arrayBuffers, rss: memory.rss };
}

async function waitForReady(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const onData = (chunk) => {
      output += String(chunk);
      const match = output.match(/READY (\d+)/);
      if (!match) return;
      cleanup();
      resolve(Number(match[1]));
    };
    const onErrorData = (chunk) => { errors += String(chunk); };
    const onExit = () => { cleanup(); reject(new Error(`reader_exited_before_ready:${errors.slice(0, 500)}`)); };
    const cleanup = () => { child.stdout.off("data", onData); child.stderr.off("data", onErrorData); child.off("exit", onExit); };
    child.stdout.on("data", onData);
    child.stderr.on("data", onErrorData);
    child.on("exit", onExit);
  });
}

async function waitForReaderSuccess(rows) {
  const deadline = Date.now() + MAX_READER_LATENCY_MS;
  while (Date.now() < deadline) {
    if (rows.some((row) => row.ok)) return;
    await delay(100);
  }
  throw new Error("reader_initial_timeout");
}

async function waitForReaderCursor(rows, cursor) {
  const deadline = Date.now() + MAX_READER_LATENCY_MS;
  while (Date.now() < deadline) {
    if (rows.some((row) => row.ok && row.cursor >= cursor)) return;
    await delay(100);
  }
  throw new Error(`reader_cursor_timeout:${cursor}`);
}

function minimumCursor(state) {
  const values = Object.values(state.cursors ?? {}).map((cursor) => cursor.blockNumber).filter(Number.isFinite);
  return values.length ? Math.min(...values) : 0;
}

function serializeState(state) { return `${JSON.stringify(state, null, 2)}\n`; }
function address(value) { return `0x${value.toString(16).padStart(40, "0")}`; }
function hashHex(value) { return `0x${createHash("sha256").update(String(value)).digest("hex")}`; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
function elapsedMs(started) { return Number(process.hrtime.bigint() - started) / 1_000_000; }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function readProcessWriteBytes() { return Number(readFileSync("/proc/self/io", "utf8").match(/^write_bytes:\s+(\d+)$/m)?.[1] ?? 0); }
function readOptional(file) { try { return readFileSync(file, "utf8").trim(); } catch { return null; } }
function required(index) { const value = process.argv[index]; if (!value) throw new Error(`argument_${index}_required`); return path.resolve(value); }
function assertEqual(actual, expected, reason) { if (actual !== expected) throw new Error(`${reason}:${actual}:${expected}`); }
function writeReport(file, value) { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 }); }
