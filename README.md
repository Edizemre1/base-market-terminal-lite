# Mergen.finance Base Terminal

Mergen is a source-correct, multi-market terminal for Base. The canonical `/terminal` workspace combines live discovery, six bounded opportunity streams, a dense market board, selected-pool inspection, local watchlists and alerts, a four-market OHLCV view, and a wallet-gated transaction path.

Production remains read-only. Quote and transaction capabilities are disabled unless the deployment explicitly enables the staging flags. Mergen never requests a wallet, signs, approves, or broadcasts on initial load.

## Product surface

- DexScreener Base discovery with distinct pool identities and 10–15 second foreground refresh.
- Lazy GeckoTerminal OHLCV only for the selected pool and up to four pinned pools.
- Deterministic New on Base, Top Gainers, Top Losers, Volume Inflow/Leaders, Liquidity Movers, and Most Traded streams with four-row summaries and bounded expansion.
- Up to 40 market rows per progressive batch with real filters, result count, column visibility, density, sorting, and local persistence.
- Route-backed selection through `/terminal?pair=<pool-address>` without leaving the workspace.
- EIP-6963 wallet picker, exact Base chain checks, safe balance reads, and no provider calls before an allowed explicit/restore path.
- Indicative market context separated from server transaction quotes.
- Staging-gated LI.FI quote, review, exact ERC-20 approval, mandatory wallet simulation, and explicit swap submission.
- Full TR/EN UI, responsive layouts, accessible dialogs, and honest missing/delayed/offline states.

## Data and identity

The terminal uses one `MarketTerminalSnapshot`. Pool address is canonical when available; symbols are display-only and same-symbol pools are never merged. Missing values are unavailable rather than zero. Market cap is never substituted with FDV.

DexScreener is the discovery/snapshot source. GeckoTerminal supplies public OHLCV where available. Virtuals, Clanker, Zora, holder, insider, smart-money, and safety claims remain disabled until an authoritative adapter exists.

The explicit sample route is `/terminal?data=mock`. Sample rows are labeled and never substitute for a failed live response.

## Quote and execution boundary

The default environment requires no secrets and exposes no transaction capability. Staging may set:

```text
MERGEN_QUOTE_ENABLED=true
MERGEN_SWAP_EXECUTION_ENABLED=true
LIFI_API_KEY=<optional server-only key>
```

LI.FI is the configured server-side transaction-quote adapter. OpenOcean and Odos are reported disabled because no verified adapter is configured. Quote requests are rate-limited, deduplicated, cached briefly, timed out, and protected by a bounded circuit breaker.

A server response is a validated transaction quote, not yet an executable transaction. Submission eligibility requires the connected wallet, Base chain 8453, exact token metadata and raw amounts, current balance and allowance, unexpired fingerprinted calldata, and a fresh wallet simulation. Exact approval and swap are two separate user actions; unlimited approval is never generated.

Production flags and deployment units must not be changed for staging work.

## Routes

- `/terminal` — canonical terminal
- `/terminal?view=markets`
- `/terminal?view=watchlist`
- `/terminal?view=portfolio`
- `/terminal?view=alerts`
- `/status`
- `/docs`
- `/settings`
- `/api/health`

Legacy `/`, `/dashboard`, and `/swap` entries preserve query parameters and redirect to `/terminal`.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000/terminal?data=mock` for deterministic UI inspection.

Light local checks:

```bash
npm run typecheck
npm run lint
npm run test:providers
```

GitHub Actions owns the Linux/Node 22 production build, Chromium matrix, deterministic wallet/quote/transaction mocks, visual evidence, and exact-SHA staging artifact. CI runs only for PRs targeting `main` and pushes to `main`; feature-branch pushes alone do not run it. See [AGENTS.md](AGENTS.md) and [the implementation ledger](docs/terminal-v3-implementation-ledger.md).

## Safety notes

- Never enter a seed phrase or private key.
- Market heuristics are explainable discovery aids, not advice or safety scores.
- Wallet confirmation is always user-owned; deterministic tests never send real transactions.
- Provider failures preserve a bounded last-good snapshot and clearly mark it delayed.
- Build artifacts reject secrets, environment files, symlinks, hard links, unsafe paths, and SHA/inventory mismatches.
