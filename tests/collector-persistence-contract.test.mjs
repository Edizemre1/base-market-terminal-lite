import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { createJournalCursor, journalDigest, journalPayload, replayJournalChunk } from "../collector/journal.mjs";
import { DurableDiscoveryStore, createIntegrity, initialState, readStoreSnapshotSync } from "../collector/store.mjs";
import { classifyCollectorFailure, failureBackoffMs } from "../collector/service.mjs";

const NOW = new Date("2026-09-20T12:00:00.000Z");

test("status-only and no-op cycles write zero canonical checkpoint and zero WAL bytes", async () => {
  const directory = await temporary("status-only");
  const store = configuredStore(directory);
  try {
    await store.open();
    const before = await readFile(path.join(directory, "state.json"));
    for (let index = 0; index < 12; index += 1) {
      await store.updateRuntimeStatus("loop-head-status", { loops: { head: { phase: "idle", sample: index } } });
    }
    await store.transact("no-op", () => {}, undefined, { derive: false });
    const after = await readFile(path.join(directory, "state.json"));
    assert.deepEqual(after, before);
    await assert.rejects(readFile(path.join(directory, "wal.ndjson")), { code: "ENOENT" });
    assert.equal(store.getMetrics().statusOnlyUpdates, 12);
    assert.equal(store.getMetrics().noOpTransactions, 1);
    assert.equal(store.getMetrics().journalBytes, 0);
    assert.equal(store.getMetrics().checkpointBytes, 0);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a real change is acknowledged by a small prepare/commit delta before sparse checkpoint", async () => {
  const directory = await temporary("delta");
  const store = configuredStore(directory);
  try {
    await store.open();
    const checkpointBefore = await readFile(path.join(directory, "state.json"));
    await store.transact("fixture-head", (draft) => {
      draft.currentHead = 123;
      draft.confirmedHead = 121;
      draft.health.lastHeadObservedAt = NOW.toISOString();
    }, undefined, { derive: false });
    assert.deepEqual(await readFile(path.join(directory, "state.json")), checkpointBefore);
    const rows = (await readFile(path.join(directory, "wal.ndjson"), "utf8")).trim().split(/\r?\n/).map(JSON.parse);
    assert.deepEqual(rows.map((row) => row.type), ["prepare", "commit"]);
    assert.equal(rows[0].journalVersion, 2);
    assert.ok(rows[0].patch.length > 0);
    assert.equal(readStoreSnapshotSync(directory).state.currentHead, 123);
    assert.equal(store.getMetrics().checkpoints, 0);
    assert.ok(store.getMetrics().journalBytes < checkpointBefore.length);
  } finally {
    await store.close();
    const checkpoint = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
    assert.equal(checkpoint.currentHead, 123);
    assert.equal(checkpoint.persistence.appliedSequence, 1);
    assert.equal((await readFile(path.join(directory, "wal.ndjson"))).length, 0);
    await rm(directory, { recursive: true, force: true });
  }
});

test("committed journal recovery survives an incomplete tail and preserves cursor-like state", async () => {
  const source = await temporary("recovery-source");
  const recovery = await temporary("recovery-copy");
  const store = configuredStore(source);
  try {
    await store.open();
    await store.transact("cursor", (draft) => {
      const key = Object.keys(draft.cursors)[0];
      draft.cursors[key] = { blockNumber: 456, blockHash: `0x${"a".repeat(64)}`, updatedAt: NOW.toISOString() };
    }, undefined, { derive: false });
    await copyCheckpointAndWal(source, recovery);
    const completeJournalBytes = (await stat(path.join(recovery, "wal.ndjson"))).size;
    await appendFile(path.join(recovery, "wal.ndjson"), "{\"journalVersion\":2,\"type\":\"prepare\"");
    const reopened = configuredStore(recovery);
    try {
      const state = await reopened.open();
      assert.equal(Object.values(state.cursors)[0].blockNumber, 456);
      assert.equal(reopened.getMetrics().recoveredTransactions, 1);
      assert.ok(reopened.getMetrics().tornTailBytes > 0);
      assert.equal((await stat(path.join(recovery, "wal.ndjson"))).size, completeJournalBytes);
      assert.equal(reopened.integrityCheck().ok, true);
    } finally { await reopened.close(); }
  } finally {
    await store.close();
    await rm(source, { recursive: true, force: true });
    await rm(recovery, { recursive: true, force: true });
  }
});

test("SIGTERM produces a clean checkpoint and removes the writer lock", { skip: process.platform === "win32" ? "POSIX signal semantics are validated in Linux CI" : false }, async () => {
  const directory = await temporary("sigterm");
  const child = crashWorker(directory, 700);
  try {
    await waitForOutput(child, "READY");
    const exited = once(child, "exit");
    assert.equal(child.kill("SIGTERM"), true);
    const [code, signal] = await exited;
    assert.equal(code, 0);
    assert.equal(signal, null);
    assert.equal(readStoreSnapshotSync(directory).state.currentHead, 700);
    await assert.rejects(readFile(path.join(directory, "collector.lock")), { code: "ENOENT" });
    assert.equal((await readFile(path.join(directory, "wal.ndjson"))).length, 0);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("SIGKILL leaves a recoverable committed delta and stale lock", async () => {
  const directory = await temporary("sigkill");
  const child = crashWorker(directory, 900);
  try {
    await waitForOutput(child, "READY");
    const exited = once(child, "exit");
    assert.equal(child.kill("SIGKILL"), true);
    await exited;
    assert.ok((await readFile(path.join(directory, "wal.ndjson"))).length > 0);
    assert.ok((await readFile(path.join(directory, "collector.lock"))).length > 0);
    const reopened = configuredStore(directory);
    try {
      assert.equal((await reopened.open()).currentHead, 900);
      assert.equal(reopened.getMetrics().recoveredTransactions, 1);
    } finally { await reopened.close(); }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

test("a prepare without a durable commit is not acknowledged or replayed", async () => {
  const directory = await temporary("prepare-only");
  let inject = true;
  const store = configuredStore(directory, {
    faultInjector(stage) {
      if (inject && stage === "after-journal-prepare") {
        const error = new Error("disk full");
        error.code = "ENOSPC";
        throw error;
      }
    }
  });
  try {
    await store.open();
    await assert.rejects(store.transact("uncommitted", (draft) => { draft.currentHead = 999; }, undefined, { derive: false }), /disk full/);
    assert.equal(store.read().currentHead, 0);
    inject = false;
    await store.close();
    const reopened = configuredStore(directory);
    try { assert.equal((await reopened.open()).currentHead, 0); }
    finally { await reopened.close(); }
  } finally {
    inject = false;
    await store.close().catch(() => {});
    await rm(directory, { recursive: true, force: true });
  }
});

test("checkpoint rename failure retains the acknowledged WAL for restart recovery", async () => {
  const source = await temporary("rename-source");
  const recovery = await temporary("rename-copy");
  let failRename = true;
  const store = configuredStore(source, {
    checkpointTransactionLimit: 1,
    faultInjector(stage) {
      if (failRename && stage === "before-checkpoint-rename") {
        failRename = false;
        throw new Error("rename injection");
      }
    }
  });
  try {
    await store.open();
    await store.transact("rename-safe", (draft) => { draft.currentHead = 321; }, undefined, { derive: false });
    assert.equal(store.getMetrics().checkpointFailures, 1);
    await copyCheckpointAndWal(source, recovery);
    const reopened = configuredStore(recovery);
    try { assert.equal((await reopened.open()).currentHead, 321); }
    finally { await reopened.close(); }
  } finally {
    await store.close();
    await rm(source, { recursive: true, force: true });
    await rm(recovery, { recursive: true, force: true });
  }
});

test("journal rejects a commit without its prepare and detects chain tampering", () => {
  const state = initialState(NOW);
  const cursor = createJournalCursor(state);
  const transactionId = randomUUID();
  const commit = { journalVersion: 2, type: "commit", transactionId, sequence: 1, afterDigest: "a".repeat(64) };
  assert.throws(() => replayJournalChunk(cursor, `${JSON.stringify(commit)}\n`), /without_prepare/);

  const prepare = { journalVersion: 2, type: "prepare", transactionId, sequence: 1, at: NOW.toISOString(), reason: "tamper", beforeDigest: cursor.digest, patch: [{ op: "set", path: ["currentHead"], value: 1 }] };
  prepare.afterDigest = journalDigest(prepare.beforeDigest, journalPayload(prepare));
  prepare.patch[0].value = 2;
  assert.throws(() => replayJournalChunk(createJournalCursor(initialState(NOW)), `${JSON.stringify(prepare)}\n${JSON.stringify({ ...commit, afterDigest: prepare.afterDigest })}\n`), /digest_mismatch/);
});

test("transaction queue is bounded and exposes backpressure evidence", async () => {
  const directory = await temporary("queue");
  const store = configuredStore(directory, { maxPendingTransactions: 2 });
  try {
    await store.open();
    const operations = Array.from({ length: 8 }, (_, index) => store.transact(`queued-${index}`, async (draft) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      draft.health.queueFixture = index;
    }, undefined, { derive: false }));
    await Promise.all(operations);
    assert.ok(store.getMetrics().queuePeak <= 2);
    assert.ok(store.getMetrics().backpressureWaits > 0);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failure backoff is jittered, bounded, classified and never exits the process", () => {
  assert.equal(failureBackoffMs(1, 300_000, () => 0), 1_000);
  assert.equal(failureBackoffMs(2, 300_000, () => 0), 2_000);
  assert.equal(failureBackoffMs(3, 300_000, () => 0), 4_000);
  assert.equal(failureBackoffMs(99, 300_000, () => 1), 300_000);
  assert.equal(classifyCollectorFailure("rpc_cursor_changed_during_validation"), "cursor_validation");
  assert.equal(classifyCollectorFailure("metadata_cycle_deadline_exceeded"), "cycle_deadline");
  assert.equal(classifyCollectorFailure("rpc_http_403"), "rpc_provider");
  assert.equal(classifyCollectorFailure("ENOSPC"), "resource_storage");
});

test("legacy schema-v1 checkpoint remains valid and immutable until a real delta checkpoints", async () => {
  const directory = await temporary("legacy");
  const state = initialState(NOW);
  state.health.legacyMarker = "preserved";
  state.integrity = createIntegrity(state);
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  await writeFile(path.join(directory, "state.json"), serialized, { mode: 0o640 });
  const store = configuredStore(directory);
  try {
    assert.equal((await store.open()).health.legacyMarker, "preserved");
    await store.updateRuntimeStatus("status", { loops: { head: { phase: "idle" } } });
    await store.close();
    assert.equal(await readFile(path.join(directory, "state.json"), "utf8"), serialized);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

function configuredStore(directory, options = {}) {
  return new DurableDiscoveryStore(directory, {
    now: () => NOW,
    checkpointIntervalMs: 24 * 60 * 60_000,
    checkpointTransactionLimit: 256,
    metricsLogger: null,
    ...options
  });
}

async function temporary(label) {
  const directory = await mkdtemp(path.join(tmpdir(), `base-collector-${label}-`));
  await mkdir(directory, { recursive: true });
  return directory;
}

async function copyCheckpointAndWal(source, target) {
  await copyFile(path.join(source, "state.json"), path.join(target, "state.json"));
  await copyFile(path.join(source, "wal.ndjson"), path.join(target, "wal.ndjson"));
}

function crashWorker(directory, head) {
  const fixture = fileURLToPath(new URL("./fixtures/collector-crash-worker.mjs", import.meta.url));
  return spawn(process.execPath, [fixture, directory, String(head)], { stdio: ["ignore", "pipe", "pipe"] });
}

async function waitForOutput(child, expected) {
  return new Promise((resolve, reject) => {
    let output = "";
    let errors = "";
    const onData = (chunk) => {
      output += String(chunk);
      if (!output.includes(expected)) return;
      cleanup();
      resolve(output);
    };
    const onErrorData = (chunk) => { errors += String(chunk); };
    const onExit = () => {
      cleanup();
      reject(new Error(`worker_exited_before_${expected}:${errors.slice(0, 500)}`));
    };
    const cleanup = () => {
      child.stdout.off("data", onData);
      child.stderr.off("data", onErrorData);
      child.off("exit", onExit);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onErrorData);
    child.on("exit", onExit);
  });
}
