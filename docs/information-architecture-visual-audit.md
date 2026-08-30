# Base Terminal information architecture visual audit

This ledger records the PR #32 finishing pass against the canonical scanner → board → inspector → action flow. The market, opportunity, signal, identity, tradeability, quote, wallet, and transaction models are unchanged; only their presentation and interaction ownership changed.

| Previous problem | Implemented solution | Information priority | Repetition removed | Overlay type | Responsive result |
| --- | --- | --- | --- | --- | --- |
| Four opportunity lanes competed for the first viewport | One six-tab Opportunity Scanner renders one category list at a time | `rowPrimary` | The same token no longer appears in four simultaneous panels | none | Horizontal tabs and two compact preview rows remain usable at 390 px; the category count and Markets link expose the complete set |
| Selected market, activity, detail tabs, and trade dock were permanently visible | Selection opens a closable Context Inspector; full chart/activity moves to route-backed Pair Workspace | `inspectorDetails` | Permanent selected-market and chart blocks leave the scanner view | `market_inspector` | Right context column on desktop; bottom sheet with safe-area spacing on mobile |
| Trade controls occupied desktop space before explicit intent | Buy/Sell opens a dedicated Trade Drawer | action layer | Permanent Trade Dock removed from Terminal, Markets, Watchlist, and Portfolio | `trade_drawer` | Right drawer on desktop; independent bottom sheet on mobile |
| Wallet and transaction modals could stack over drawers without shared ownership | Overlay Manager suspends the current drawer for a modal and restores it on close | modal | Nested main overlays removed | `wallet_picker`, `transaction_review` | One visible modal, body lock only for modal/mobile sheet, Escape restores the suspended drawer |
| Matrix showed fourteen data columns by default | Market Board defaults to Market, Price, 5m, 1h, Volume, Liquidity, Age, Signals, Action | `rowPrimary` | Provider, trade state, pools, FDV, and trades move to opt-in columns | `columns` | Ten complete rows fit at 1440×900; cards replace the table below the desktop breakpoint |
| Filters were a permanent multi-row form and columns used an independent popover | Filter and column sheets use draft state with Apply/Cancel/Clear and preview result count | contextual controls | Filter controls no longer dominate the board | `filters`, `columns` | Side sheet on desktop and bottom sheet on compact layouts |
| Every row repeated “Market data only”, “Wallet required”, and unknown-security labels | Presentation selectors suppress neutral states and retain only confirmed row-critical states | `rowCritical`, `hiddenNeutral` | Neutral identity/tradeability copy appears only in inspector/trade context | signal detail remains contextual | Rows stay scannable; full evidence remains available from inspector and trade surfaces |
| Signals could repeat security-unknown and contract-verified on every row | Row signals exclude neutral identity/security facts, show at most two badges, and retain `+N` | `rowPrimary` | Repeated neutral signal icons removed | `signal_details` | Compact icons remain tap targets; detailed evidence remains localized |
| Pool detail was opened by local component state | Pool action is owned by the central overlay state and exact opportunity id | `inspectorDetails` | No separate matrix-owned modal lifecycle | `pool_drawer` | Right/bottom drawer retains exact pool and provider facts |
| Live reorder could disturb scanner category and filters | Scanner tab and board preferences use stable opportunity keys and safe local persistence | state continuity | No duplicate transient list | none | Selected tab, filters, columns, and scroll context survive healthy snapshot updates |

## Visual acceptance matrix

GitHub Actions captures the following artifacts in both English and Turkish where applicable:

- Terminal default: 1440×900, 1280×800, 1024×768, 768×1024, 390×844
- Context Inspector: 1440×900
- Trade Drawer: 1440×900
- Market detail sheet: 390×844
- Trade sheet: 390×844
- Pair Workspace: 1440×900
- Wallet Picker: 1440×900
- Transaction review mock: 1440×900

Acceptance requires no horizontal document overflow, no nested interactive controls, one main overlay state, no console errors, and at least ten fully visible board rows at 1440×900 in the default English mock fixture.
