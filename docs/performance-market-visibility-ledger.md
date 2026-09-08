# Performance and market visibility recovery ledger

This ledger freezes the pre-change evidence for the recovery pass that starts at exact SHA `57ddd1d87205983dd21c72bc9659abf150d41bec`. It is intentionally separate from the production-candidate ledger. The product remains the existing Calm Market Intelligence terminal; this pass changes navigation/data boundaries and discovery visibility, not the visual language.

## Measurement boundary

- Staging release, web and collector were exact `57ddd1d87205983dd21c72bc9659abf150d41bec`; both services were active/running with restart count `0`.
- Measurements used the staging service's read-only loopback HTTP endpoint. Public staging continued to require Basic Auth. The Codex in-app browser had no valid saved credential and returned `ERR_INVALID_AUTH_CREDENTIALS`, so no authenticated DOM action or auth bypass was attempted.
- The eight route shapes were sampled serially ten times each with `Cache-Control: no-cache`. Because the application cache has a 12-second TTL and every response rebuilds/serializes the route, these are mixed warm/expired-cache samples; the high tail is the user-visible provider-refresh path. Exact cold first-load evidence is recorded separately.
- Store and JSON parsing were sampled ten times each in-place on the VPS. No snapshot/store contents, secret, environment value, wallet or transaction data were printed or changed.

## Pre-change route evidence

| Transition shape | Samples | Response bytes | TTFB p50 | TTFB p95 | Complete p50 | Complete p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Terminal | 10 | 7,266,262-7,408,681 | 464.0 ms | 4,103.8 ms | 744.1 ms | 4,493.6 ms |
| Terminal -> Markets | 10 | 7,232,088-7,372,989 | 760.4 ms | 5,183.0 ms | 1,031.1 ms | 5,568.2 ms |
| Terminal -> Watchlist | 10 | 7,175,563-7,317,193 | 786.5 ms | 4,272.9 ms | 1,066.1 ms | 4,833.8 ms |
| Terminal -> Portfolio | 10 | 7,170,172 | 462.1 ms | 762.6 ms | 829.6 ms | 1,033.5 ms |
| Terminal -> Alerts | 10 | 7,172,799-7,311,756 | 460.3 ms | 3,883.9 ms | 671.1 ms | 4,211.0 ms |
| Board row -> Inspector | 10 | 7,253,618-7,394,309 | 501.5 ms | 3,109.0 ms | 679.4 ms | 3,422.9 ms |
| Market -> Pair Workspace | 10 | 7,210,050 | 440.0 ms | 727.3 ms | 623.8 ms | 934.6 ms |
| Back/forward route shape | 10 | 7,233,614-7,374,261 | 378.9 ms | 2,818.6 ms | 621.1 ms | 2,946.4 ms |

Exact first cold `/terminal` sample: status `200`, TTFB `7,357.295 ms`, complete `7,664.080 ms`, body `7,273,664 bytes`, one document request. A warm snapshot API sample was status `200`, TTFB `103.234 ms`, complete `187.028 ms`, body `6,352,853 bytes`.

The pre-change browser timing matrix cannot truthfully split click-to-URL, React commit, meaningful content, interactive, request count and long tasks without an authenticated browser session. The final candidate must therefore add an exact production-build browser timing artifact at 1280 and 390, ten cold and ten warm transitions per required flow, and staging acceptance must combine it with live loopback/public-boundary evidence. Missing measurements are not treated as zero.

## Pre-change snapshot/store evidence

| Operation | Samples | Bytes | p50 | p95 |
| --- | ---: | ---: | ---: | ---: |
| Durable store read | 10 | 25,328,940 | 73.11 ms | 109.68 ms |
| Durable store JSON parse | 10 | 25,328,940 | 85.94 ms | 130.88 ms |
| Snapshot response JSON parse | 10 | 6,438,733 | 24.13 ms | 31.98 ms |

The same immutable store file is synchronously read, parsed and integrity-checked independently by `mergeOnchainPoolsIntoPairs()` and `getOnchainPricingStatus()` during one snapshot build. The page then serializes roughly 6.4-7.4 MB again for every `?view=` or `?pair=` navigation. A route whose 12-second process cache has expired additionally waits for the complete provider snapshot build before returning.

## Pre-change market funnel

At one exact delayed snapshot observation:

| Stage | Count |
| --- | ---: |
| Raw pools | 1,000 |
| Unique pools in API | 1,000 |
| Opportunities in API | 600 |
| Fresh pair rows after global delayed projection | 0 |
| Canonical-priced | 2 |
| Quote-checkable/ranking eligible | 2 |
| Board default quality gate | 2 in API model; 4 in the sampled server render |
| Board all non-expired/non-rejected | 99 |
| Observed provider/on-chain market price | 31 |
| Quality bands | RANKED 2 / EMERGING 2 / DETECTED 95 / REJECTED 501 |

The rendered terminal reported `4 results`, `4` unique wall opportunities and `0` cross-lane duplicates. Lane visible/eligible counts in order New, Gainers, Losers, Volume, Liquidity, Most Traded were `4/7`, `0/0`, `0/0`, `0/0`, `0/0`, `0/0`.

## Proven P0 causes

| ID | Surface | User impact | Technical cause | Pre-change proof | Required correction | Status |
| --- | --- | --- | --- | --- | --- | --- |
| PERF-P0-01 | Terminal navigation | Internal tabs feel like full reloads and reach 2.9-5.6 s p95, with a 7.66 s cold load | Navigation writes `view`/`pair` through the Next router. Every query change reruns the async server page, waits on `getMarketTerminalSnapshot()`, serializes the full snapshot and remounts client state | 7.17-7.41 MB returned per route; code path is `Link/router -> terminal/page.tsx -> await getMarketTerminalSnapshot()` | Preserve the mounted client terminal, update route state/history synchronously, handle popstate, prefetch the terminal shell and refresh the shared last-good snapshot only in the background | Implemented; Actions/staging acceptance pending |
| PERF-P0-02 | Snapshot lifecycle | Expired cache makes a user click wait on provider/network work; duplicate store parse and serialization consume the main path | First live snapshot has no last-good fast path; store reads are not keyed/shared; page and API independently ship the complete pool-heavy graph | Cold TTFB 7,357 ms; store read+parse p95 240.56 ms per call; API 6.44 MB; source shows multiple `readOnchainStoreSnapshot()` calls | Cache the verified store by file identity, coalesce refresh, retain last-good, move all provider work behind background refresh, and publish a compact UI snapshot | Implemented; Actions/staging acceptance pending |
| VIS-P0-01 | Market Board | Hundreds of real opportunities collapse to 2-4 rows | Default `quality` view admits only RANKED or high-quality EMERGING. Stale v5 persisted filters can retain an even narrower state | API funnel 600 opportunities -> 99 non-rejected -> 2 default; rendered Board 4 | Version preferences, migrate old storage, make `all` the unfiltered default and keep quality/expert views explicit | Implemented; Actions/staging acceptance pending |
| VIS-P0-02 | Live Wall/ticker | Five lanes are empty and most prices read pending | Live/provider lanes call `isFreshRanked()`, which requires active + RANKED + canonical-priced + globally non-stale. A background refresh marks the entire last-good snapshot delayed and every pair stale. Liquidity has no leaders fallback | Rendered lane eligibility `7/0/0/0/0/0`; global freshness delayed; only 2 canonical prices versus 31 observed prices | Build discovery lanes from exact fresh provider metrics without execution proof, separate source delay from global delay, add honest volume/liquidity leader fallbacks and bounded cross-lane repeats | Implemented; Actions/staging acceptance pending |
| LIVE-P0-01 | Live updates | `48 updates waiting` freezes values and makes the terminal look dead | Any changed pair is queued; the entire snapshot, including metric values and freshness, is withheld until Apply/idle | `shouldQueueMarketUpdate()` returns true for every non-zero change count | Apply value/status patches immediately and queue only membership/order; coalesce and auto-apply bounded placement updates | Implemented; Actions/staging acceptance pending |

## Candidate implementation contract

- Primary terminal views and pair Inspector/workspace state now use one mounted client shell with native History API state and explicit `popstate` synchronization. Route changes do not request or deserialize another terminal RSC payload.
- The verified on-chain store is cached by exact resolved file, size and modification time. Merge and pricing consumers share the same parsed result; a changed file invalidates the cache.
- A cold server process publishes the durable last-good collector snapshot immediately and starts external provider refresh in the background. Only the provider source is marked delayed/refreshing unless the base snapshot itself is stale.
- Live client payloads retain every non-expired, non-REJECTED opportunity and its exact referenced pools while preserving full universe and exclusion counts in `visibilityFunnel`. This removes rejected-pool serialization without hiding discovery markets that lack canonical execution proof.
- Concurrent browser snapshot requests coalesce, ETags avoid reparsing unchanged payloads, subscriber abort does not cancel another subscriber, and request ids reject stale completions.
- Board preferences moved from schema `v5` to `v6`; the default is `All live markets`. Primary pair labels remain explicit and observed provider prices are labelled `Market price`, not executable quotes.
- Gainers/losers use exact fresh provider 24h change. Volume and liquidity use comparable deltas when available and honest leaders otherwise. Most Traded uses real buy+sell counts; missing values remain missing. Deterministic allocation guarantees a real candidate is not hidden by global diversity and caps cross-lane use at two.
- Value, percentage, volume, freshness and status updates apply immediately. Only placement/order is held while hover, focus, scroll or an Inspector is active; the pending set remains coalesced and bounded.
- The signal popover is capped to one short evidence card with collision-aware desktop placement and a mobile sheet. Full evidence opens the fixed Inspector signals tab; Escape, outside click and focus return remain supported.

## Invariants

- Discovery visibility never implies canonical price, executable quote or transaction readiness.
- Provider market price remains labelled as market data, never as a quote.
- Trade Dock still requires exact token identity, ranking/proof gates, explicit quote, simulation and wallet-owned confirmations.
- Missing values remain missing; stale/future/non-finite evidence is never promoted.
- Contract-first identity, one opportunity per token contract and separate same-symbol contracts remain unchanged.
- Production, Basic Auth, real wallets, approvals, signatures and transactions are outside this pass.
