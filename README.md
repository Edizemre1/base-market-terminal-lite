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

Default mode is mock/demo:

```bash
MARKET_DATA_MODE=mock
```

DexScreener read-only mode is opt-in:

```bash
MARKET_DATA_MODE=dexscreener
```

`NEXT_PUBLIC_MARKET_DATA_MODE=mock` is still supported for compatibility. If mode is missing, invalid, rate-limited, or DexScreener returns no usable Base pairs, the app safely falls back to bundled mock data.

No API key is needed. The provider layer is read-only and does not enable live trading, wallet actions, approvals, or transaction building.

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
