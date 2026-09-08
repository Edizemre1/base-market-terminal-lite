# Base Terminal development policy

- Treat GitHub `Edizemre1/base-market-terminal-lite` as the only code synchronization source. On another computer, commit and push work, then verify the exact remote SHA before continuing.
- Keep local checks light and targeted. Run full build, full regression, Linux validation, and browser E2E in GitHub Actions.
- Keep the shared GitHub Actions spend below the $20 monthly ceiling. Do not rerun the same SHA; let a newer PR SHA cancel its superseded run.
- CI runs only for pull requests targeting `main` and pushes to `main`. A feature-branch push alone must not create a run.
- Preserve dependency and Next build caches with fail-open restore keys. Change cache keys when the lockfile, Node contract, or relevant build sources change.
- Node 22 is the CI contract. The supported application runtime range is recorded in `package.json`.
- Docker and WSL are not the default development path. The VPS is a deployment target, not a CI or build machine.
- Never include secrets or environment files in build artifacts. Deploy only an exact GREEN artifact whose commit SHA and manifest have been verified.
