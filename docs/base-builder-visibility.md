# Base Builder Visibility

Mergen.finance Base Swap Terminal is prepared as a public read-only builder demo for the Base ecosystem.

## What This Demo Proves

- A focused Base market terminal UI for pair discovery and inspection.
- Read-only provider integration with public market data boundaries.
- Selected pair inspection with price, liquidity, volume, OHLCV chart, activity, and public detail fields.
- Browser-local watchlist, URL pair deep-links, search, filters, and sorting.
- Provider health, stale-state handling, and last-good snapshot behavior.
- A safe no-transaction boundary with the swap preview disabled.
- Regression coverage with provider fixtures and Playwright smoke tests.

## Intentionally Excluded

- Wallet connection.
- Swap execution.
- Signing or approvals.
- Transaction construction.
- Platform fee logic.
- Private backend or indexer.
- Private risk scoring.
- API keys, secrets, backend auth, or database.

## Future Private Roadmap

- Wallet integration behind a reviewed account and chain-state boundary.
- Swap routing through a quote service before any transaction-building work.
- Fee logic with explicit public product requirements.
- Builder Code/ERC-8021 attribution for future private transaction work.
- Production backend or indexer for rate limits, enrichment, credentials, and resilience.

## Public Boundary

The public demo remains read-only. Market signals are transparent heuristics from displayed provider data and are not investment advice, safety guarantees, or private scoring.
