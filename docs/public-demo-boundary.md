# Public Demo Boundary

Mergen.finance Base Terminal is a production read-only Base market radar and pair-inspection surface. The same exact build may expose a separately configured, safety-gated transaction lifecycle on staging only.

- Market data uses public read-only provider data by default; labeled sample data requires explicit selection.
- Provider failure or sparse results never cause sample prices to be inserted into the live-data view.
- Market context never claims a route. A ranking-eligible row opens a quote check; only a fresh exact staging quote may advance to review.
- Production keeps wallet signing, approvals, transaction construction, and transaction execution disabled. Explicitly enabled staging may expose the separate quote → review → exact approval → simulation → wallet confirmation lifecycle; it never auto-connects, auto-signs, or auto-submits.
- No API keys, secrets, backend auth, database, private scoring, or private business logic is included.
- Local search, deep links, filters, sorting, and watchlist state run in the browser over loaded provider snapshots.
- Production/private transaction features should be developed behind separate reviewed boundaries.
- Builder Code/ERC-8021 attribution belongs to later private transaction work, not this public demo yet.
