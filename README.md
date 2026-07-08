# Base Terminal Lite

Standalone public MVP for a focused Base on-chain swap/radar terminal. The app defaults to local mock data and can optionally use read-only public DexScreener data for Base pairs.

Live demo: https://base-market-terminal-lite-1stf8lo85-eddie0159.vercel.app/

## Safety Boundaries

- No unrelated private branding.
- No private business logic.
- No real API keys or backend secrets.
- No paid product logic.
- No real transactions, approvals, wallet signing, or swap execution.
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

No API key is needed. DexScreener and OHLCV modes are read-only and do not enable live trading, wallet actions, approvals, transaction execution, or transaction building.

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
```

## Project Structure

```text
src/app/                 App Router pages
src/components/          Reusable UI components
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
