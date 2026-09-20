import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { getPriority, tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { DurableDiscoveryStore, createIntegrity, initialState, readStoreSnapshotSync } from "../collector/store.mjs";

const ITERATIONS = 16;
const FIXTURE_POOLS = 1_500;
const FIXTURE_PADDING_BYTES = 6_144;

const worker = argument("--worker");
if (worker) {
  const directory = argument("--directory");
  if (!directory) throw new Error("benchmark_worker_directory_missing");
  const result = worker === "legacy" ? await runLegacy(directory) : worker === "delta" ? await runDelta(directory) : undefined;
  if (!result) throw new Error("benchmark_worker_unknown");
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  const output = argument("--output") ?? path.resolve("test-results/collector-resource-benchmark.json");
  const root = mkdtempSync(path.join(tmpdir(), "base-collector-benchmark-"));
  try {
    const before = runWorker("legacy", path.join(root, "legacy"));
    const after = runWorker("delta", path.join(root, "delta"));
    if (before.fixtureDigest !== after.fixtureDigest || before.fixtureBytes !== after.fixtureBytes) throw new Error("benchmark_fixture_mismatch");
    const report = {
      schemaVersion: 1,
      sourceSha: process.env.SOURCE_SHA || process.env.GITHUB_SHA || "local-unpinned",
      generatedAt: new Date().toISOString(),
      workload: { kind: "status_only_heartbeat", iterations: ITERATIONS, pools: FIXTURE_POOLS, paddingBytesPerPool: FIXTURE_PADDING_BYTES },
      fixture: { sha256: before.fixtureDigest, bytes: before.fixtureBytes },
      enforcedCgroup: readCgroupLimits(),
      before,
      after,
      reduction: {
        logicalBytesPercent: percentageReduction(before.logicalBytes, after.logicalBytes),
        physicalBytesPercent: percentageReduction(before.physicalBytes, after.physicalBytes),
        cpuPercent: percentageReduction(before.cpuMs, after.cpuMs),
        wallPercent: percentageReduction(before.wallMs, after.wallMs)
      },
      crashContracts: "tests/collector-persistence-contract.test.mjs"
    };
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o640 });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runLegacy(directory) {
  mkdirSync(directory, { recursive: true });
  let state = fixtureState();
  const statePath = path.join(directory, "state.json");
  const walPath = path.join(directory, "wal.ndjson");
  writeFileSync(statePath, serializeState(state), { encoding: "utf8", mode: 0o640 });
  writeFileSync(walPath, "", { encoding: "utf8", mode: 0o640 });
  const fixtureBytes = statSync(statePath).size;
  const fixtureDigest = sha256(readFileSync(statePath));
  const started = process.hrtime.bigint();
  const cpuStarted = process.cpuUsage();
  const ioStarted = readProcessWriteBytes();
  let logicalBytes = 0;
  for (let index = 0; index < ITERATIONS; index += 1) {
    const beforeDigest = state.integrity.digest;
    const next = structuredClone(state);
    next.updatedAt = timestamp(index + 1);
    next.health.loops = { head: { phase: "idle", sample: index, observedAt: next.updatedAt } };
    next.integrity = createIntegrity(next);
    const transactionId = randomUUID();
    logicalBytes += appendAndSync(walPath, `${JSON.stringify({ type: "prepare", transactionId, at: next.updatedAt, reason: "loop-head-status", beforeDigest, afterDigest: next.integrity.digest })}\n`);
    logicalBytes += atomicWriteAndSync(statePath, serializeState(next));
    logicalBytes += appendAndSync(walPath, `${JSON.stringify({ type: "commit", transactionId, at: next.updatedAt, afterDigest: next.integrity.digest })}\n`);
    state = next;
  }
  const recoveryStarted = process.hrtime.bigint();
  const recovered = JSON.parse(readFileSync(statePath, "utf8"));
  if (createIntegrity(recovered).digest !== recovered.integrity.digest) throw new Error("legacy_recovery_digest_mismatch");
  const recoveryMs = elapsedMs(recoveryStarted);
  return measuredResult("legacy_full_checkpoint_per_status", { started, cpuStarted, ioStarted, logicalBytes, fixtureBytes, fixtureDigest, directory, recoveryMs, queuePeak: 1 });
}

async function runDelta(directory) {
  mkdirSync(directory, { recursive: true });
  const state = fixtureState();
  const statePath = path.join(directory, "state.json");
  writeFileSync(statePath, serializeState(state), { encoding: "utf8", mode: 0o640 });
  const fixtureBytes = statSync(statePath).size;
  const fixtureDigest = sha256(readFileSync(statePath));
  const store = new DurableDiscoveryStore(directory, {
    checkpointIntervalMs: 24 * 60 * 60_000,
    checkpointTransactionLimit: 256,
    maxPendingTransactions: 8,
    metricsLogger: null
  });
  await store.open();
  const started = process.hrtime.bigint();
  const cpuStarted = process.cpuUsage();
  const ioStarted = readProcessWriteBytes();
  for (let index = 0; index < ITERATIONS; index += 1) {
    await store.updateRuntimeStatus("loop-head-status", { loops: { head: { phase: "idle", sample: index, observedAt: timestamp(index + 1) } } });
  }
  const metrics = store.getMetrics();
  const recoveryStarted = process.hrtime.bigint();
  const recovered = readStoreSnapshotSync(directory);
  if (recovered.state.integrity.digest !== state.integrity.digest) throw new Error("delta_status_mutated_checkpoint");
  const recoveryMs = elapsedMs(recoveryStarted);
  const result = measuredResult("delta_journal_runtime_status", {
    started,
    cpuStarted,
    ioStarted,
    logicalBytes: metrics.journalBytes + metrics.checkpointBytes,
    fixtureBytes,
    fixtureDigest,
    directory,
    recoveryMs,
    queuePeak: metrics.queuePeak,
    statusOnlyUpdates: metrics.statusOnlyUpdates,
    backpressureWaits: metrics.backpressureWaits
  });
  await store.close();
  return result;
}

function fixtureState() {
  const state = initialState(new Date("2026-09-20T00:00:00.000Z"));
  const padding = "x".repeat(FIXTURE_PADDING_BYTES);
  for (let index = 0; index < FIXTURE_POOLS; index += 1) {
    const pool = `0x${index.toString(16).padStart(40, "0")}`;
    state.pools[`fixture:${pool}`] = {
      poolKey: `fixture:${pool}`,
      poolAddress: pool,
      token0: "0x0000000000000000000000000000000000000001",
      token1: "0x0000000000000000000000000000000000000002",
      detectedAt: "2026-09-20T00:00:00.000Z",
      fixturePadding: padding
    };
  }
  state.health.loops = {};
  state.integrity = createIntegrity(state);
  return state;
}

function runWorker(kind, directory) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--worker", kind, "--directory", directory], { encoding: "utf8", env: process.env });
  if (child.status !== 0) throw new Error(`benchmark_${kind}_failed:${String(child.stderr).slice(0, 1_000)}`);
  return JSON.parse(child.stdout.trim());
}

function measuredResult(implementation, values) {
  const cpu = process.cpuUsage(values.cpuStarted);
  const physicalBytes = Math.max(0, readProcessWriteBytes() - values.ioStarted);
  return {
    implementation,
    fixtureBytes: values.fixtureBytes,
    fixtureDigest: values.fixtureDigest,
    iterations: ITERATIONS,
    logicalBytes: values.logicalBytes,
    physicalBytes,
    cpuMs: (cpu.user + cpu.system) / 1_000,
    wallMs: elapsedMs(values.started),
    maxRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1_024),
    recoveryMs: values.recoveryMs,
    queuePeak: values.queuePeak,
    statusOnlyUpdates: values.statusOnlyUpdates ?? 0,
    backpressureWaits: values.backpressureWaits ?? 0,
    stateBytes: statSync(path.join(values.directory, "state.json")).size,
    walBytes: existsSync(path.join(values.directory, "wal.ndjson")) ? statSync(path.join(values.directory, "wal.ndjson")).size : 0
  };
}

function serializeState(state) {
  return `${JSON.stringify(state, null, 2)}\n`;
}

function appendAndSync(file, text) {
  const descriptor = openSync(file, "a", 0o640);
  try {
    const bytes = writeSync(descriptor, text, undefined, "utf8");
    fsyncSync(descriptor);
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function atomicWriteAndSync(file, text) {
  const temporary = `${file}.${process.pid}.tmp`;
  const descriptor = openSync(temporary, "wx", 0o640);
  try {
    writeSync(descriptor, text, undefined, "utf8");
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  renameSync(temporary, file);
  const directory = openSync(path.dirname(file), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return Buffer.byteLength(text, "utf8");
}

function readProcessWriteBytes() {
  try {
    const match = readFileSync("/proc/self/io", "utf8").match(/^write_bytes:\s+(\d+)$/m);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function readCgroupLimits() {
  return {
    cpuMax: readOptional("/sys/fs/cgroup/cpu.max"),
    memoryMax: readOptional("/sys/fs/cgroup/memory.max"),
    ioWeight: readOptional("/sys/fs/cgroup/io.weight"),
    nice: getPriority()
  };
}

function readOptional(file) {
  try { return readFileSync(file, "utf8").trim(); }
  catch { return null; }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function timestamp(index) {
  return new Date(Date.parse("2026-09-20T00:00:00.000Z") + index * 1_000).toISOString();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function elapsedMs(started) {
  return Number(process.hrtime.bigint() - started) / 1_000_000;
}

function percentageReduction(before, after) {
  if (!(before > 0)) return null;
  return Math.round((1 - after / before) * 100_000) / 1_000;
}
