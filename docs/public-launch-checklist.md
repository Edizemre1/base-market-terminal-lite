# Public Launch Checklist

Mergen Finance Base Terminal is a read-only production market terminal with a separately configured, safety-gated transaction lifecycle on staging. Use this checklist before sharing the repo or a release externally.

## Demo Checks

- The exact production-candidate artifact is GREEN, manifest-verified, and deployed only to authenticated staging before release.
- Main terminal loads in read-only provider mode without sample-price substitution.
- Explicit `?data=mock` mode remains clearly labeled for deterministic UI exploration.
- Read-only market data mode loads without requiring client-side provider secrets.
- `/status` renders public demo status.
- `/api/health` returns safe read-only JSON only.

## Repo Checks

- README explains the live demo, status page, health endpoint, features, tests, and safety boundary.
- Public demo boundary doc is current.
- No unrelated private branding or private product copy is present.
- No API keys, secrets, protected environment files, collector stores, or private operational data are included in the artifact.
- Production transaction execution remains disabled. Staging quote, exact approval, simulation, and swap actions require explicit environment capability plus explicit wallet actions.
- Pair details and market signals are described as public read-only heuristics, not financial advice or private scoring.

## Test Commands

Run only focused contracts and changed-file lint locally. The full sequence below belongs to the exact pull-request SHA in GitHub Actions:

```bash
npm run typecheck
npm run lint
npm run build
npm run test:providers
npm run test:e2e
```

## Deployment Checks

- GitHub Actions passes on the exact candidate SHA and uploads both the verified staging archive and visual evidence.
- Artifact source SHA, manifest, inventory, and checksum match before activation.
- Authenticated staging web and collector run the same release, preserve the store, and pass the detached soak.
- The active release, immediate rollback, protected rollback chain, environment, unit definitions, and collector store remain protected by retention.
- Production SHA, PID, restart count, configuration, and public authentication boundary remain unchanged.
- Status page still shows read-only boundaries.
- Health endpoint does not expose environment variables or provider internals.

## Public Posting Checklist

- Share the live demo link.
- Share the GitHub repository link.
- Describe production as a read-only Base market intelligence terminal.
- Mention the safe boundaries: wallet connection is explicit and optional; transaction execution is disabled in production; staging actions never auto-connect, auto-sign, or auto-submit.
- Point builders to the provider architecture, local watchlist, search, filters, and tests.
- Invite feedback from Base builders, GitHub reviewers, and the Base community.

## Future Attribution Boundary

Builder Code/ERC-8021 attribution belongs to future private transaction work. It is intentionally not part of this read-only public demo.
