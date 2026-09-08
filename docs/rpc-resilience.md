# Collector RPC resilience and bounded backfill

## Verified baseline (2026-09-03 20:17 UTC)

PR #32 started at `acf9765d4b6878e9409c52f618d5e568a3d21e4d`, matching local, origin and the open/draft PR. Staging collector PID 816958 was running that release.

All factory cursors were 50,812,406, last committed at 05:42 UTC. Independently observed Base head was 50,838,644. Stored head 50,812,408 and reported lag zero were stale. The snapshot still changed because pool-state and anchor transactions continued. The current universe was 2,000 pools: 169 complete, 294 pending, 24 rejected, 1,513 not yet classified. All 512 queue rows had attempts zero.

The journal had no per-method scan instrumentation. The exact unresolved historical await cannot be honestly recovered from it. Bounded read-only probes found the primary responsive, and configured alternatives that could read Base blocks but returned HTTP 403 or -32603/-32602 for state/log methods. No live endpoint was deliberately broken.

Code evidence: scan awaited all log/verification windows and inline metadata before publishing progress, with no cycle deadline; fetch relied only on abort cooperation. Head was not independently published. Every dequeued pool retry was reseeded with attempts zero. Anchor refresh could reuse an old head and substitute refreshed provider observations for fresh on-chain state.

## Safety model

- Head, ingestion, metadata, provider, pool-state and anchor cycles have separate deadlines and loop health. Retryable failure does not exit the process. Timers/listeners and aborted budget waiters are removed. Late work is fenced at durable writes.
- Discovery commits one verified window at a time, including exact cursor hash. Dense windows shrink within the existing maximum; no cursor jump, bootstrap reset or history skip. Malformed windows fail closed. Factory log hashes must match block evidence.
- Derived pricing has no remote I/O. A derivation failure preserves last-good opportunities and marks readiness false while ingestion can commit; the next transaction retries. Status-only publication does not repeatedly rebuild pricing.
- One transport owns all RPC lanes. Global concurrency 2, endpoint concurrency 1, at most two distinct endpoints per logical request, bounded waiting queue. Existing discovery pacing remains 3 seconds. Pool-state tick remains one network job by default; existing freshness/TTL/cycle limits are not increased.
- Primary and explicitly configured Base endpoints are deduplicated and capped at four, with official public Base standard/Flashblocks fallbacks. Public fallback starts are at least one second apart. Only confirmed/exact tags are used, never pending preconfirmations. Endpoint labels contain no URL/key.
- Eligibility requires chain 8453, a valid recent head and durable cursor hash continuity. Old hash-less cursors establish a checkpoint on the first validated endpoint; all fallback endpoints must agree. Wrong-chain, malformed responses and conflicting block hashes quarantine the endpoint. Behind endpoints cool down. HTTP 403/invalid-method capability failures back off only the method.
- Timeout, transport, 429/5xx and `-32016` are provider failures, not permanent pool rejection. Per-method exponential cooldown (bounded at 60 seconds plus <=500 ms jitter), controlled half-open recovery and safe error history are exposed in health.
- A fallback repeats a whole pool-state batch at the same exact block number/hash/timestamp. Partial results are never spliced across endpoints. A behind fallback cannot supply that block. Last-good state is retained on refresh failure without changing its observation time. Duplicate/out-of-order/same-height hash-conflicting updates cannot replace it.

## Persistent scheduler and financial correctness

The queue is capped at 512 within the existing 2,000-pool universe. History lives in `pool.backfill`: attempts, processed count, consecutive failures, next attempt, cooldown, safe endpoint label, error class and last successful block/hash/time. Dequeue/restart cannot reset it. Priority is exact WETH/USDC, supported provider match, USDC/WETH pair, newly detected, actual market evidence, retryable, remaining supported. One priority level per waiting minute provides bounded-universe fairness. Unsupported/local metadata checks consume no state RPC. Unsupported pools cool down six hours; rejected/dust pools one hour; retryable failures exponentially back off up to 15 minutes.

Anchor refresh reuses only immutable identity, not old price proof. It obtains fresh exact confirmed state even for trusted pools, preserves decimals/orientation and derives liquidity from raw on-chain amounts. Unsupported stable/V4/Infinity pricing remains unavailable. Provider-only observations do not become canonical proof; missing/zero, stale/fresh, conflicts and tier requirements remain distinct.

Retention keeps the same limits/protected matched pools. Eviction counters and bounded reconciliation records distinguish explicit oldest-unprotected retention from unexplained loss.

## Observability and acceptance

Health includes loop last success/error/recovery/retry, RPC endpoint/method circuits and counters, independent head, durable cursor/progress, real lag, snapshot/head age, backfill counters/coverage and anchor status. Cumulative attempt counters and current per-pool coverage are different measurements. Retained complete state may be stale; complete is not a freshness claim.

SSE starts with a status/checkpoint, not a historical transition. Reconnect only returns greater numeric event IDs. An expired/invalid cursor requests a new snapshot instead of replaying an arbitrary ring. Cancellation releases listeners, timers and the client slot once. Semantic transitions deduplicate touched pool keys and do not invent previous states.

Local verification is restricted to short focused files/name filters, changed lint, one typecheck and static/diff guards. Heavy tests/build/browser/artifact checks run on the exact new PR SHA in Actions. No same-SHA rerun, Docker, WSL or Python. Only an exact GREEN artifact can activate staging; production remains read-only. Live acceptance and a detached 20-minute soak must establish real progress/recovery before reporting completion.

Official endpoint reference: [Base RPC overview](https://docs.base.org/base-chain/api-reference/rpc-overview).
