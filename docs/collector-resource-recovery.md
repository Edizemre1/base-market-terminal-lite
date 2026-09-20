# Collector resource recovery and canary contract

This document covers the staging collector only. It does not authorize a start, enable, deploy, store mutation, or production change.

## Persistence contract

The externally visible store remains schema version 1. An existing integrity-checked `state.json` is a valid checkpoint and is not rewritten merely because the new collector opens, reports status, or shuts down. Durable domain changes are serialized by one writer and acknowledged only after a version-2 hash-chained `prepare` plus matching `commit` record have both been appended and fsynced. Runtime heartbeats and unchanged transactions write neither the checkpoint nor the journal.

Committed deltas are replayed over the checkpoint after restart. A prepare without a commit is ignored. A partial final line is treated as a torn tail, while malformed complete rows, sequence gaps, a commit without its prepare, or a digest-chain mismatch fail closed. Checkpoints are sparse: normally no more often than every 15 minutes or 256 committed transactions, with an earlier checkpoint only when the WAL reaches 75% of its limit. Checkpoint replacement is atomic and fsynced before the WAL is rotated.

The web reader caches the verified checkpoint and its replay cursor. It reads only newly appended WAL bytes until checkpoint rotation; it does not re-read and re-parse the complete store on every request.

## Hard bounds and backpressure

| Resource | Bound |
| --- | ---: |
| Pools / canonical events / opportunities | 2,000 / 5,000 / 2,000 |
| Metadata / on-chain / enrichment queues | 256 / 512 / 512 |
| Pending store transactions | 24, FIFO backpressure above the bound |
| One pool, event, or metadata delta value | 512 KiB |
| Opportunities payload | 16 MiB |
| One delta | 24 MiB |
| WAL / checkpoint | 64 MiB / 64 MiB |
| Store files total | 128 MiB plus a small lock and filesystem metadata |

Every committed reason records transaction count, delta bytes, journal bytes, duration, CPU time, patch count, queue peak and wait time. Recovery records replayed transactions, duration and torn-tail bytes. Metrics are emitted at most once per minute and are capped at 16 KiB per line.

The staging unit safety envelope is `CPUQuota=25%`, `MemoryMax=512M`, `IOWeight=50`, `Nice=10`, and `LimitCORE=0`. `IOWeight` is relative, not an absolute write cap. Before a canary, resolve the store's backing block device with `findmnt` and add the separately reviewed `IOWriteBandwidthMax=<exact-device> 262144` bytes/second cap. Do not guess a device path. Canary acceptance additionally requires at most 128 MiB written in 30 minutes, a projected steady-state budget below 256 MiB/hour and 2 GiB/day, and no monotonically growing queue or WAL. Crossing any budget is an automatic stop and rollback condition.

## Production-shape startup regression

The Linux acceptance job creates a secrets-free, production-shaped checkpoint of exactly 25,200,033 bytes in runner-temporary storage. It covers the maximum 2,000 pools, 5,000 canonical events and 2,000 opportunities, both 512-entry work queues, large records, a real committed cursor change, checkpoint/recovery and a concurrent web reader. The fixture is deleted by the job and is never packaged in the release artifact.

The failure reproducer runs in the main isolate with the canary's 512 MiB cgroup and a 256 MiB old-space setting, which reproduces the measured 271,581,184-byte V8 heap limit. It intentionally retains repeated full-state structured clones and must fail with `SIGABRT`, V8 heap exhaustion and the native `node::worker::Message::Deserialize` frame. That native namespace does not prove an application worker: the collector creates no `worker_threads.Worker`, and the recorded isolate identity must be `isMainThread=true`, `threadId=0`.

Acceptance uses the same CPU, memory, I/O weight, nice level and 262,144-byte/second write cap. It records `heapUsed`, `external`, `arrayBuffers`, process RSS and cgroup memory separately at parse, initialization, mutation, journal and checkpoint phases. Full-state snapshots are not passed between collector loops. A transaction keeps one bounded draft; journal integrity is streamed into SHA-256; checkpoint work is queued behind the durable WAL commit so readers and independent loops do not wait on disk throttling. Checkpoint wall time, CPU time, serialization time, physical write time and estimated disk-wait time are reported separately. The earlier raw `101433` checkpoint duration is milliseconds (about 101.433 seconds), consistent with a roughly 25 MiB atomic checkpoint under the 262,144-byte/second cap, not 101,433 seconds.

The job fails closed unless initialization finishes, both queues remain bounded, a real cursor commit is recovered after a crash-shaped copy, a concurrent reader observes the new cursor without timeout, status-only updates produce zero physical writes, peak heap remains below 85% of the actual V8 limit and total cgroup writes remain below 128 MiB. This is CI evidence only; it does not authorize starting or enabling a live collector.

## Failure policy

Independent loop failures use jittered exponential delay: 1 s, 2 s, 4 s and so on, capped at 5 minutes. Eight consecutive failures open that loop's circuit and expose `consecutive_failure_threshold_exceeded`; the process remains alive for diagnosis and never enters a tight crash/restart loop. Error output is structured and bounded and never includes provider response bodies or private URLs.

Failure classes are distinct:

- `rpc_provider`: provider/RPC transport or HTTP failure.
- `cursor_validation`: head/cursor changed while validating a scan.
- `cycle_deadline`: a bounded cycle exceeded its deadline.
- `resource_storage`: ENOSPC, checkpoint, journal or disk-bound failure.
- `collector_operation`: another local collector operation failed.

Derived opportunity rebuild failures preserve the last-good pool/opportunity view, mark the derived lane retrying, and do not roll back an already durable ingestion delta.

## Upgrade and rollback semantics

Before a canary, stop the collector and preserve the exact release pointer, unit/drop-in hashes, environment-file hash, `state.json`, `wal.ndjson`, owner/mode, byte counts and SHA-256 digests. Never edit or prune the only preserved store.

The new reader can open the legacy schema-v1 checkpoint and ignores legacy WAL bookkeeping because legacy commits were already materialized into `state.json`. A code rollback is safe only after a clean stop of the new collector has checkpointed all committed version-2 deltas. Verify `appliedSequence`, checkpoint integrity, an empty WAL and the absence of `collector.lock` before switching code. If the new process did not stop cleanly, do not point old code at a WAL-only state: either recover and checkpoint with the exact new candidate offline, or restore the preserved pre-canary checkpoint/WAL pair and explicitly accept loss of canary-only observations.

## Prepared 30-minute canary (not executed)

1. Require an exact GREEN Actions SHA and independently verified artifact/manifest. Reconfirm the staging collector is disabled, inactive and PID 0; confirm no deploy, retention, rollback or extraction is active.
2. Record service/resource baselines, backing device, cgroup write counters, store hashes, cursor/head/lag and other Mergen service invariants. Create a read-only rollback bundle without modifying the source store.
3. Install the exact candidate and absolute device write-cap drop-in. Arm an independent root-owned 30-minute auto-stop before starting the collector. The stop guard must target only `mergen-base-terminal-staging-collector.service` and remain effective if SSH disconnects.
4. Start the collector without enabling it. Sample at minutes 0, 5, 10, 15, 20, 25 and 30: PID/restarts, CPU/RSS, cgroup writes, iowait/utilization, state/WAL bytes, store integrity, queue depths, cursor progress, freshness, loop failures and budget projection.
5. Stop immediately on a crash/restart, integrity/recovery failure, queue or WAL monotonic growth, any hard-limit breach, write rate over 2 MiB/s, more than 128 MiB in the window, or a change to a protected service. Preserve evidence; do not retry the same SHA.
6. At minute 30 the independent guard stops the collector. Confirm disabled/inactive/PID 0. Accept only after a clean checkpoint and full evidence review. Otherwise restore the exact pre-canary release and store pair. Never start production from this procedure.
