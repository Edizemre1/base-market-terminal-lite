# Base Terminal Lite

Public read-only Base market terminal demo for pair discovery, inspection, chart review, local watchlists, and disabled swap-preview workflows. The app defaults to local mock data and can optionally use public read-only provider data for Base pairs.

## Launch Links

- Live demo: https://base-market-terminal-lite-1stf8lo85-eddie0159.vercel.app/
- Public status page: `/status`
- Health endpoint: `/api/health`

## Core Features

- DexScreener read-only Base radar for New Pairs, Volume Inflow, and Momentum feeds.
- GeckoTerminal read-only OHLCV chart support with synthetic fallback.
- Compact topbar search over loaded provider data.
- URL pair deep-links through `pair=<pairId-or-pairAddress>`.
- Browser-local watchlist stored in `localStorage`.
- Provider health, stale-data states, and last-good snapshot behavior.
- Radar filters, sorting, and transparent local presets.
- Public pair detail fields and market quality signals derived from displayed data only.

## Safety Boundaries

- No unrelated private branding.
- No private business logic.
- No wallet connection.
- No swaps, signing, approvals, transaction construction, or transaction execution.
- No real API keys, backend secrets, backend auth, or database.
- No paid product logic.
- No private scoring or investment advice.
- Mock/demo Base pair data by default.
- DexScreener mode is read-only market data only.
- Risk labels are demo/derived UI states, not live token safety assessments.

## Data Mode

Default mode is mock/demo. Use the topbar data source switch to choose between:

- `MOCK FEED`
- `READ-ONLY MARKET DATA`

The switch updates the URL query string:

- Mock mode: `/`
- DexScreener mode: `/?data=dexscreener`

No Vercel environment variable setup is required. `MARKET_DATA_MODE=mock`, `MARKET_DATA_MODE=dexscreener`, and `NEXT_PUBLIC_MARKET_DATA_MODE=mock` remain supported for compatibility, but the public app can switch data sources directly from the UI.

DexScreener rows are filtered to Base pairs with usable price, pair address, token sides, liquidity above `$10K`, and 24h volume above `$5K`. New Pairs shows only qualified read-only pairs under 7 days old. Volume Inflow and Momentum may show a separate `Demo fallback` section when qualified read-only data is limited, and the app shows `Read-only market data + demo fallback`.

Chart data is read-only and cached, not streaming. In read-only market data mode, the app attempts optional GeckoTerminal OHLCV candles for valid Base pool addresses with 60-second revalidation. No API key is required. If OHLCV is unavailable, empty, rate-limited, or unsupported for a pair, the chart safely falls back to the synthetic preview and labels it as unavailable.

Topbar search is local and read-only over the loaded provider snapshot. Selected pairs can be shared with `pair=<pairId-or-pairAddress>` while preserving `data=dexscreener` when read-only market data mode is active.

Watchlist pins are browser-local and stored in `localStorage`. There is no account, backend, trading, or transaction execution attached to pinned pairs.

In read-only market data mode, the terminal refreshes provider snapshots about every 60 seconds without reloading the page. The last good snapshot remains visible if a provider refresh fails, and compact stale/failed states show when data is old or unavailable.

External provider responses are defensively normalized before they reach the terminal UI. Missing or malformed fields are dropped or treated as unavailable, and provider timeouts keep the last good/stale UI state visible instead of blanking the app.

Selected pair details can show public read-only provider fields such as addresses, source links, windowed volume/change, transaction counts, FDV, and market cap when available. Public market quality signals are transparent heuristics from displayed data only, not financial advice or private scoring.

Radar filters, sorting, and presets are local read-only views over the loaded provider snapshot. Presets are transparent filter/sort combinations, not financial advice, private scoring, or trading recommendations.

No API key is needed. DexScreener and OHLCV modes are read-only and do not enable live trading, wallet actions, approvals, transaction execution, or transaction building.

## Public Demo Boundary

Base Terminal Lite is a public read-only demo. Private or production transaction work belongs behind separate reviewed boundaries. Builder Code/ERC-8021 attribution belongs to later private transaction work, not this public demo yet.

See [Public Demo Boundary](docs/public-demo-boundary.md) for the concise public/private boundary.
See [Public Launch Checklist](docs/public-launch-checklist.md) and [Base Builder Visibility](docs/base-builder-visibility.md) for launch-readiness notes.

## What Is Included

- Single-page Base pair radar terminal.
- New Pairs, Volume Inflow, and Momentum opportunity feeds.
- Selected pair workspace with chart, risk, liquidity, and activity modules.
- Always-visible swap preview ticket with disabled execution.
- Simple docs page with public safety boundaries.
- Reusable terminal shell and compact panel components.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- lucide-react icons

## Getting Started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run dev
npm run build
npm run typecheck
npm run lint
npm run test:providers
npm run test:e2e
```

`npm run test:e2e` runs Playwright smoke/regression tests against the local Next.js dev server. The tests cover read-only terminal loading, pair selection URL state, search, local watchlist persistence, filters/sorting, provider health, and disabled swap execution.
`npm run test:providers` runs fixture-based provider parsing tests without live external provider calls.

## Testing

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:providers`
- `npm run test:e2e`

## Project Structure

```text
src/app/                 App Router pages
src/components/          Reusable UI components
docs/                    Public demo boundary notes
src/data/                Mock Base pair data, provider layer, and builder log content
src/data/providers/      Read-only market data provider contract and adapters
src/lib/                 Formatting and utility helpers
src/types/               Shared TypeScript domain types
```

## Future Integration Boundaries

- Wallet connection: add a wallet adapter layer for account state and chain checks.
- Real Base pair data: use read-only provider adapters behind `src/data/providers/`.
- Provider boundary: route future real data through a private backend or indexer when credentials, rate limits, or enrichment are needed.
- Swap routing: introduce a quote service before any transaction-building code.
- Platform fee boundary: keep policy and calculation outside this MVP until product requirements are public and reviewed.
- Secret management: load future provider keys only from deployment secrets, never source files.

## Review Notes

The MVP is intentionally committed in small slices so reviewers can inspect mock data, shell, terminal interaction, secondary route cleanup, docs, and verification separately.
