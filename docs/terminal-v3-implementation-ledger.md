# Terminal V3 implementation ledger

This ledger records the decisions that keep the terminal source-correct while it grows from a read-only market surface into a transaction-capable staging product.

## Invariants retained

- One canonical `MarketTerminalSnapshot` supplies every market surface. Pair identity is Base chain + token addresses + pool address; symbols are presentation only.
- Missing market fields remain unavailable. They are never coerced into zero, safety, popularity, or a favorable signal.
- Existing finite-number, reciprocal-price, OHLCV, stale snapshot, alert, wallet race, EIP-6963, Base chain, BigInt balance, locale, sanitization, accessibility, and responsive contracts stay in force.
- One wallet controller owns provider selection and lifecycle. Initial page load makes no provider request unless an exact previously verified provider is restored under the existing contract.
- Production stays read-only. Transaction execution is a server capability enabled only by an explicit staging environment flag.

## Information architecture

- `/terminal` is canonical. The primary navigation is Terminal, Markets, Watchlist, Portfolio, and Alerts.
- Terminal combines a real market tape, six deterministic and bounded opportunity streams, a dense market board, a closable context inspector, a route-backed pair workspace, a pinned multichart, and an intent-opened trade drawer.
- A single refresh loop owns snapshots. Selected and pinned OHLCV remain lazy and bounded.
- User interaction freezes disruptive reordering; a pending snapshot is applied explicitly or after the existing safe unlock period.

## Market capabilities

- DexScreener remains discovery and pair-snapshot source. Multiple legitimate pools for the same token route are retained and sorted by canonical pool key.
- GeckoTerminal remains lazy read-only OHLCV for selected and pinned markets.
- New, gainers, losers, volume inflow/leaders, liquidity movers, and most-traded streams are deterministic and only use fields that exist for the relevant window. Missing values remain missing rather than becoming zero, and no stream is advice or a safety score.
- Virtuals, Clanker, Zora, holder, insider, smart-money, and security labels stay disabled unless a trustworthy adapter supplies verifiable data.

## Quote and execution capability

- Server-side quote abstraction tries providers sequentially. LI.FI is primary. OpenOcean may be an explicitly enabled public fallback. Odos stays disabled until an explicit configuration and authoritative contract are available.
- Quote requests use exact Base token addresses, connected wallet, exact decimal amount, and slippage. Timeouts, small in-memory caches, in-flight coalescing, bounded circuits, and response validation are mandatory.
- Indicative context never contains calldata. The server returns a validated transaction quote, not an executable claim. Execution becomes eligible only after a fresh wallet simulation and revalidation of target, calldata, value, chain, raw amounts, balance, allowance, minimum receive, timestamps, and expiry.
- The quote fingerprint binds wallet, chain, pair orientation, token metadata, amounts, slippage, provider route, target, calldata, value, and expiry. Any bound-field change invalidates review.
- ERC-20 approval is exact-amount only, is shown separately, and requires its own user action. Swap requires a second user action after chain, balance, allowance, expiry, fingerprint, and simulation checks.
- There is no automatic signing or broadcasting. Duplicate approval/swap submissions are locked. User rejection, submission, pending, confirmation, failure, and replacement remain explicit states.

## Staging and release gates

- `MERGEN_SWAP_EXECUTION_ENABLED=true` is staging-only. The public production unit and environment are not edited.
- Health output reports quote and execution capabilities without revealing provider secrets or upstream internals.
- Deterministic CI uses mocked wallet, quote, approval, simulation, and transaction responses; it never moves funds.
- Only an exact-green artifact may be deployed. The staging candidate is smoked on an isolated localhost port, atomically exchanged, and observed at 0/5/10/15/20/25/30 minutes. Production baselines must match before and after.

## Capability status

| Capability | Status | Reason |
| --- | --- | --- |
| DexScreener discovery | enabled | Existing public, read-only adapter |
| GeckoTerminal OHLCV | enabled | Existing lazy, read-only adapter |
| LI.FI transaction quote | staging-gated | Official public quote endpoint; optional server API key; becomes execution-ready only after wallet simulation |
| OpenOcean fallback | disabled | No verified adapter is configured in the current repository |
| Odos fallback | disabled | No existing configured/verified adapter contract |
| Transaction execution | staging-gated | Requires explicit environment flag and two user actions |
| Virtuals/launch lifecycle | disabled | No verified adapter in the current repository |
| Holder/security/smart-money labels | disabled | No authoritative data source in the current repository |
