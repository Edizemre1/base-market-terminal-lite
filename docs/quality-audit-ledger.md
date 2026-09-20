# Base Terminal quality audit ledger

Audit date: 2026-08-29  
Scope: PR #32, read-only Mergen Pulse Terminal  
Starting revision: `c0dd96fc384d049ccea087005360c9aa93ff2b31`

## Inventory

The audit covers 12 user-addressable routes/surfaces and 28 distinct interaction or data states (40 route/state cases), in Turkish and English.

Routes/surfaces: Pulse, Markets, Watchlist, Alerts, Wallet, Pair Workspace, `/dashboard`, `/swap`, Status, Docs, token redirect, and 404.

States: search/results/no-results; filters closed/open/empty/selected-hidden; wallet picker empty/provider/error, connected, wrong-chain; Action Dock collapsed/expanded/invalid-input; chart available/unavailable/stale/refreshing/last-available/expanded; market activity empty/populated; provider fresh/delayed/failure/offline/recovery; loading; desktop navigation; mobile navigation.

Viewport contract: 1920×1080, 1440×900, 1280×800, 1024×768, 768×1024, 430×932, 390×844, and 360×800.

## Severity summary

| Severity | Found | Fixed | Open |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 12 | 12 | 0 |
| P2 | 14 | 14 | 0 |
| P3 | 4 | 4 | 0 |

## P1 findings

1. Provider strings accepted partial numbers such as `1abc`; parsing is now strict and finite.
2. Future pair creation times could appear as new pairs; future ages are rejected and zero-minute age is distinct.
3. Invalid/future/duplicate OHLCV and negative volume were not fully rejected; normalization and UTC aggregation are deterministic.
4. Reverse price, return, and OHLC high/low rules lacked a shared verified contract; exact inverse helpers and tests now cover them.
5. Legacy and normalized volume/liquidity/change fields could diverge between screens; primary surfaces now use the same selectors and preserve missing versus zero.
6. Activity/momentum ranking could reward lower liquidity and equal rows could jump; scoring is monotonic and canonical ties are stable.
7. Older or duplicate live snapshots could be evaluated after newer data; chronology, malformed time, duplicate, and future-clock guards now gate signals and UI state.
8. Alert input could silently misread locale decimals or untrusted stored thresholds; ambiguous input is rejected and exact crossing/cooldown/rearm behavior is tested.
9. Partial chain IDs and wrong-network balances could be misrepresented as Base context; chain parsing is exact and balance reads/display are Base-only.
10. Late wallet reads could overwrite a newer account or lifecycle; generation/version checks and a deferred-balance race regression prevent it.
11. soft navigation/back-forward could leave the displayed terminal view behind the URL; client view now reconciles with route parameters.
12. Radar and local amount fields used permissive numeric parsing; they now share strict or locale-aware parsing.

## P2 findings

1. Pair Workspace rendered two `h1` elements and route titles stayed on stale Swap metadata.
2. Desktop/mobile navigation lacked `aria-current` and a skip link.
3. Mobile navigation lacked safe-area padding and explicit 44px touch targets.
4. Pair detail tabs lacked complete tab/panel relationships and arrow-key navigation.
5. Status, Docs, and 404 content was missing or mixed-language.
6. Turkish search normalization and pin/unpin accessible names were not locale-aware.
7. localStorage reads/writes could throw in restricted or quota-limited contexts.
8. Persisted visit, pin, alert, recent-pair, and wallet preference data needed tighter validation and bounds.
9. Provider source, token logo, and explorer URLs needed explicit host/address policies.
10. Untrusted provider and wallet metadata needed control-character and length bounds.
11. Visual/copy feedback timeouts could outlive their components.
12. OS notification construction failures could escape the in-app alert flow.
13. Shared number/date formatters could expose non-finite output.
14. Compact financial display and chart volume did not consistently preserve exact zero/full-value context.

## P3 findings

1. External links now state both `noopener` and `noreferrer` explicitly.
2. Product metadata no longer points to the obsolete preview URL or “Swap Terminal” title.
3. Decorative navigation/status icons are hidden from assistive technology.
4. Header heartbeat and connected-wallet accessible copy now follow the active locale.

## Financial contracts

- Direct return: `((current - previous) / previous) × 100`, only for finite positive prices.
- Reverse price: `1 / direct`, only for finite positive values.
- Reverse return: `(1 / (1 + directReturn)) - 1`; it is never implemented as a sign flip.
- Reverse OHLC: open/close invert directly; high is inverse-low and low is inverse-high.
- OHLCV: chronological input, deterministic duplicate resolution, UTC buckets, first open, max high, min low, last close, finite volume sum, no synthetic gap candles.
- Discovery: documented inclusive minimums, normalized fields only, deterministic canonical key tie-breaker, and activity score is explicitly not a safety/investment score.
- Alerts: exact inclusive crossing, one event per crossing, bounded cooldown, rearm only after returning across the threshold.
- Wallet: exact `0x2105`/`8453`, BigInt wei conversion, zero distinct from missing, and no Base balance claim on another chain.

## Bounded long-run state

Pulse history, visit snapshots, pins, recent pairs, alert rules, alert triggers, provider polling, chart refresh, copy feedback, and wallet listeners are bounded or cleaned up. Regression coverage includes 100 snapshot updates, 100 pair selections, 50 route transitions, 20 locale transitions, 20 wallet mock cycles, 100 alert evaluations, visibility cycles, storage failure, and fail/recover behavior.

## 2026-09-02 on-chain pricing coverage pass

- The live preflight covered 2,000 confirmed pools and selected reserve pools, Uniswap V3-compatible pools, and Aerodrome Slipstream as the three highest-impact exact state adapters. Singleton V4/Infinity state remains explicitly unsupported.
- Exact token identity, uint8 decimals, reserve/slot0/balance evidence, block hash/time, direct/reciprocal price, USD-liquidity derivation, and provider reconciliation are retained independently.
- Tests cover 6/8/18/255 decimals, BigInt range, zero state, stable-invariant rejection, malformed/reverted/timed-out RPC, circuit recovery, agreement/conflict, stale/future evidence, quality upgrades/downgrades, SSE identity/reconnect, reorg/dedup, and durable recovery.
- UI changes are limited to progressive evidence disclosure in Inspector and Pool Drawer; navigation, layout, typography, colors, responsive behavior, and transaction gates are unchanged.
