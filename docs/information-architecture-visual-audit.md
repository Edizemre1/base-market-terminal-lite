# Base Terminal information architecture visual audit

This ledger records the PR #32 finishing pass against the canonical scanner → board → inspector → action flow. The market, opportunity, signal, identity, tradeability, quote, wallet, and transaction models are unchanged; only their presentation and interaction ownership changed.

| Previous problem | Implemented solution | Information priority | Repetition removed | Overlay type | Responsive result |
| --- | --- | --- | --- | --- | --- |
| Four legacy opportunity lanes competed for the first viewport | Six simultaneous Live Market Wall streams each show a four-row summary with a bounded 12-row expansion | `rowPrimary` | Contract-level deduplication assigns each market to its strongest stream unless repeat mode is explicitly enabled | none | Six columns fit at 2048 px; narrower widths use intentional horizontal continuation, and mobile shows one full stream plus the next-stream cue |
| Selected market, activity, detail tabs, and trade controls competed with discovery | Selection opens a closable Context Inspector; full chart/activity and the existing Trade Dock move to the route-backed Pair Workspace | `inspectorDetails` | Permanent selected-market and chart blocks leave Pulse and Discover | `market_inspector` | Inspector is a right/bottom overlay; Pair Workspace uses chart-first main content plus a persistent 400px desktop Trade Dock |
| Trade controls were easy to lose after opening the token chart | Discover keeps Inspect/Check quote progressive; Pair Workspace keeps the existing guarded Trade Dock beside the chart and a prominent mobile action | action layer | No duplicate trade implementation or premature executable claim | `trade_drawer` on mobile | Desktop dock is continuously visible; mobile opens the same control as a bottom sheet; quote, approval, simulation and transaction gates are unchanged |
| Wallet and transaction modals could stack over drawers without shared ownership | Overlay Manager suspends the current drawer for a modal and restores it on close | modal | Nested main overlays removed | `wallet_picker`, `transaction_review` | One visible modal, body lock only for modal/mobile sheet, Escape restores the suspended drawer |
| Matrix showed fourteen data columns by default | Discover defaults to Market, Price (USD), 5m, 1h, 24h, Volume, Liquidity, Age, Signals and Action, with search in the table header | `rowPrimary` | Provider, freshness, combined data state, trade state, pools, FDV, and trades are persistent opt-in columns | `columns` | Numeric cells do not wrap; cards replace the table below the desktop breakpoint and preserve price/change/activity/age/status/action order |
| Filters were a permanent multi-row form and columns used an independent popover | Filter and column sheets use draft state with Apply/Cancel/Clear and preview result count | contextual controls | Filter controls no longer dominate the board | `filters`, `columns` | Side sheet on desktop and bottom sheet on compact layouts |
| Every row repeated “Market data only”, “Wallet required”, and unknown-security labels | Presentation selectors suppress neutral states and retain only confirmed row-critical states | `rowCritical`, `hiddenNeutral` | Neutral identity/tradeability copy appears only in inspector/trade context | signal detail remains contextual | Rows stay scannable; full evidence remains available from inspector and trade surfaces |
| Signals could repeat security-unknown, contract-verified, and global feed-delay state on every row | Row signals exclude neutral identity/security and global freshness facts, show at most two badges, and retain `+N` | `rowPrimary` | Repeated neutral/global signal icons removed | `signal_details` | Compact icons remain tap targets; detailed evidence remains localized |
| Pool detail was opened by local component state | Pool action is owned by the central overlay state and exact opportunity id | `inspectorDetails` | No separate matrix-owned modal lifecycle | `pool_drawer` | Right/bottom drawer retains exact pool and provider facts |
| Live reorder or route return could disturb scanner category, filters and reading position | Scanner tab and board preferences use stable opportunity keys and safe local persistence; Discover keeps its in-session vertical scroll position | state continuity | No duplicate transient list | none | Selected tab, filters, columns, and scroll context survive healthy snapshot updates and Pulse/Discover navigation |

## Visual acceptance matrix

GitHub Actions captures the following artifacts in both English and Turkish where applicable:

- Pulse default: 2048×1152, 1920×1080, 1728×1117, 1440×900, 1280×800, 1024×768, 768×1024, 430×932, 390×844, 360×800
- Discover: 1920×1080, 1440×900, 1280×800, 768×1024, 390×844
- Context Inspector: 1440×900
- Trade Drawer: 1440×900
- Market detail sheet: 390×844
- Trade sheet: 390×844
- Pair Workspace: 1440×900
- Real-OHLCV hover/freeze state: 1440×900
- Watchlist empty and four-market populated states: 1440×900
- Alerts empty and populated states: 1440×900
- Wallet Picker: 1440×900
- Transaction review mock: 1440×900
- Delayed, recovered, empty-lane, expanded-lane, token-collision, provider-unavailable, wrong-network, no-route, and quote-expired states: 1440×900

Acceptance requires no horizontal document overflow, no nested interactive controls, one main overlay state, no console errors, and at least ten fully visible board rows at 1440×900 in the default English mock fixture.
