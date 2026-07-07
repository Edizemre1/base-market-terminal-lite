# Base Market Terminal Lite

Standalone public MVP for a Base market terminal lite experience. The app uses local mock data only and is designed for UI review, architecture iteration, and future public integrations.

Live demo: https://base-market-terminal-lite-1stf8lo85-eddie0159.vercel.app/

## Safety Boundaries

- No unrelated private branding.
- No private business logic.
- No real API keys or backend secrets.
- No paid product logic.
- No real transactions, approvals, wallet signing, or swap execution.
- Mock/demo Base token data only.
- Risk labels are demo UI states, not live token safety assessments.

## What Is Included

- Landing page with public demo positioning.
- Market dashboard page.
- Mock Base token dataset in TypeScript.
- Trending tokens table.
- New tokens table.
- Volume gainers table.
- Demo risk/scam flag labels.
- Token detail pages.
- Swap preview page with UI-only quote calculation.
- Docs and builder log page.
- Reusable components for shell, tables, badges, metrics, charts, and forms.

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
src/data/                Mock market data and builder log content
src/lib/                 Formatting and utility helpers
src/types/               Shared TypeScript domain types
```

## Future Integration Boundaries

- Wallet connection: add a wallet adapter layer for account state and chain checks.
- Real Base token data: replace `src/data/mockTokens.ts` with a provider interface.
- Swap routing: introduce a quote service before any transaction-building code.
- Platform fee boundary: keep policy and calculation outside this MVP until product requirements are public and reviewed.
- Secret management: load future provider keys only from deployment secrets, never source files.

## Review Notes

The initial MVP is intentionally committed in small slices so reviewers can inspect scaffold, data, shared components, pages, docs, and verification separately.
