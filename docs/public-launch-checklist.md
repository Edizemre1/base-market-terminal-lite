# Public Launch Checklist

Mergen.finance Base Swap Terminal is a public read-only Base market terminal demo. Use this checklist before sharing the repo or demo externally.

## Demo Checks

- Live demo opens: https://base-market-terminal-lite-1stf8lo85-eddie0159.vercel.app/
- Main terminal loads in mock mode.
- Read-only market data mode loads without requiring Vercel environment setup.
- `/status` renders public demo status.
- `/api/health` returns safe read-only JSON only.

## Repo Checks

- README explains the live demo, status page, health endpoint, features, tests, and safety boundary.
- Public demo boundary doc is current.
- No unrelated private branding or private product copy is present.
- No API keys, secrets, backend auth, database, wallet signing, approvals, swaps, or transaction construction are present.
- Pair details and market signals are described as public read-only heuristics, not financial advice or private scoring.

## Test Commands

```bash
npm run typecheck
npm run lint
npm run build
npm run test:providers
npm run test:e2e
```

## Deployment Checks

- Vercel deployment completes successfully.
- GitHub CI passes.
- Status page still shows read-only boundaries.
- Health endpoint does not expose environment variables or provider internals.

## Public Posting Checklist

- Share the live demo link.
- Share the GitHub repository link.
- Describe it as a read-only Base market terminal demo.
- Mention the safe boundaries: no wallet, no trading, no transaction execution.
- Point builders to the provider architecture, local watchlist, search, filters, and tests.
- Invite feedback from Base builders, GitHub reviewers, and the Base community.

## Future Attribution Boundary

Builder Code/ERC-8021 attribution belongs to future private transaction work. It is intentionally not part of this read-only public demo.
