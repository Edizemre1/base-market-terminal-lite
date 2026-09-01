# On-chain Base market discovery

Base Terminal separates the raw pool universe from its contract-first user view. A single supervised Node process owns the collector store; web requests only read its integrity-checked snapshot and relay the bounded confirmed-event ring over SSE. The collector never signs, approves, builds calldata, or submits transactions.

## Data path

1. An optional Base WebSocket subscription provides provisional low-latency wake-ups.
2. Bounded `eth_getLogs` polling, two-block confirmation, and a 16-block overlap are the source of truth.
3. Pool code and available token/pool/factory getters are checked at the event block. Metadata failures degrade to partial or unavailable.
4. One writer commits the event, pool, cursor, reconciliation record, and derived token opportunities through a fsynced WAL plus atomic state-file rename.
5. A restart-safe bounded queue performs exact `8453 + lowercase pool address` lookups through the existing DexScreener and GeckoTerminal sources. Provider token addresses must match the on-chain token set; symbol/name are never join keys.
6. Supported V2/V3 readers attach exact reserve or slot0 state. V3 `liquidity()` remains raw in-range liquidity and is never labeled as USD.
7. Registered-factory WETH/USDC candidates establish a fresh, non-dust, bounded-liquidity consensus anchor with outlier rejection.
8. Canonical pricing, metrics, activation state, and opportunities rebuild in the same single-writer transaction path. Semantic SSE deltas are emitted only when state changes.
9. The web process verifies the state digest, merges provider financial fields back onto the same exact on-chain pool identities, and exposes the bounded event ring through `/api/opportunity-stream`.

Without a WebSocket URL the collector remains healthy in `confirmed_polling` mode. Provisional events never enter confirmed opportunities or the SSE confirmed-event stream.

## Factory registry

All addresses, event signatures/topics, creation blocks, confirmation settings, provenance, and adapter versions live in `collector/factory-registry.mjs`. Creation transactions were read from the contract-creator record on BaseScan and their blocks were verified with Base RPC by `collector/tools/resolve-deployment-blocks.mjs`.

| Registry id | Address | Event | Creation block |
| --- | --- | --- | ---: |
| aerodrome-classic | `0x420dd381b31aef6683db6b902084cb0ffece40da` | `PoolCreated(address,address,bool,address,uint256)` | 3,200,559 |
| aerodrome-slipstream-v1 | `0x5e7bb104d84c7cb9b682aac2f3d509f5f406809a` | `PoolCreated(address,address,int24,address)` | 13,843,704 |
| aerodrome-slipstream-v2 | `0xade65c38cd4849adba595a4323a8c7ddfe89716a` | `PoolCreated(address,address,int24,address)` | 36,953,918 |
| aerodrome-slipstream-v3 | `0xf8f2eb4940cfe7d13603dddd87f123820fc061ef` | `PoolCreated(address,address,int24,address)` | 44,394,724 |
| uniswap-v2 | `0x8909dc15e40173ff4699343b6eb8132c65e18ec6` | `PairCreated(address,address,address,uint256)` | 6,601,915 |
| uniswap-v3 | `0x33128a8fc17869897dce68ed026d694621f6fdfd` | `PoolCreated(address,address,uint24,int24,address)` | 1,371,680 |
| uniswap-v4 | `0x498581ff718922c3f8e6a244956af099b2652b2b` | `Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)` | 25,350,988 |
| pancakeswap-v2 | `0x02a84c1b3bbd7401a5f7fa98a384ebc70bb5749e` | `PairCreated(address,address,address,uint256)` | 2,910,387 |
| pancakeswap-v3 | `0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865` | `PoolCreated(address,address,uint24,int24,address)` | 2,912,007 |
| pancakeswap-infinity-cl | `0xa0ffb9c1ce1fe56963b0321b32e7a0302114058b` | `Initialize(bytes32,address,address,address,uint24,bytes32,uint160,int24)` | 30,544,106 |
| pancakeswap-infinity-bin | `0xc697d2898e0d09264376196696c51d7abbbaa4a9` | `Initialize(bytes32,address,address,address,uint24,bytes32,uint24)` | 30,544,163 |

No launchpad adapter is enabled: this pass did not validate an exact official factory plus event contract for Clanker, Virtuals, or another launchpad to the same provenance standard. No inferred or community-maintained address is accepted.

Registry entries also declare `identityReadable`, `spotPriceReadable`, `reservesReadable`, `liquidityExactlyReadable`, and `providerEnrichmentRequired`. V2-style pools expose exact reserves; Uniswap V3, Slipstream, and Pancake V3 expose exact token identity and slot0 spot state. Uniswap V4 and Pancake Infinity remain provider-enrichment-required until an official exact StateView integration is verified.

## Identity and canonical price

Raw pools retain exact pool/PoolId, factory, DEX version, token orientation, quote asset, event transaction, block, and log index. A user-facing opportunity is keyed only by `8453:token:<lowercase exact contract>`. Symbol and name are display metadata, never identity or an official/safety claim.

Canonical pricing uses exact Base USDC `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`:

- Tier A: direct verified TOKEN/USDC.
- Tier B: TOKEN/WETH multiplied by a fresh verified WETH/USDC anchor. Exact WETH is `0x4200000000000000000000000000000000000006`.
- Tier C: another verified conversion path, bounded to three hops.
- UNPRICED: no trustworthy path.

Every result carries direct/converted kind, exact source pool keys, anchor, observation time, block/provider time, freshness, quality status, tier, raw precision, deterministic display precision, selection reason, and reason code. Same-tier paths use median outlier rejection and bounded square-root liquidity weighting. Cycles, future or stale timestamps, non-positive/non-finite rates, incomplete decimals, and liquidity below the canonical-price threshold are rejected. Missing aggregate inputs remain missing; they are not replaced with zero. This analytical price is never treated as an executable LI.FI quote.

## Market quality bands and thresholds

Quality gates are centralized in `collector/market-quality.mjs` and use USD values. A provider-observed price is separate from a canonical price and always carries exact provider, pool, timestamp, freshness, and `executable: false` provenance.

- Canonical price requires at least $1,000 verified liquidity on its pricing path.
- The default Quality view may include an EMERGING opportunity from $100 known liquidity, but labels its observed value as a thin market.
- RANKED requires a fresh canonical price and at least $25,000 liquidity.
- Gainers/Losers additionally require comparable canonical snapshots and at least $50,000 liquidity.
- Volume, Liquidity, and Most Traded each require a RANKED opportunity, a real category input, and at least $1,000 liquidity.
- Missing liquidity is `liquidity_unknown`; exact zero is `zero_liquidity`; a positive sub-$1,000 value is `thin_liquidity`. These states are never collapsed into one dust boolean.

RANKED, EMERGING, DETECTED, and REJECTED/CONFLICTING remain distinct. DETECTED and rejected records stay in the operational universe, while the default board excludes their flood. Observed-only prices never enter ranking, canonical snapshot comparison, or execution.

## Targeted exact-address enrichment

New confirmed pools and prioritized unpriced opportunities enter a bounded queue. The collector requests the exact DexScreener Base pair plus the exact GeckoTerminal Base pool and pool-info endpoints. It never resolves by symbol. Requests use provider-specific timeouts and rate gates, bounded concurrency, retry/backoff, circuit breakers, in-flight coalescing, a short positive cache, and a longer negative-result TTL. A recently confirmed provider miss remains pending for bounded retry; an older exact 404 is retained as not found. Provider observations merge into one canonical pool with field-level provenance, so liquidity, volume, and transactions are not double-counted.

## Store and limits

The dependency-free schema-v1 store contains factory cursors, canonical events, pools, metadata snapshots, token opportunities, a restart-safe enrichment queue, provider field provenance, price-anchor and market-snapshot slots, reconciliation history, replay evidence, and a bounded relay ring. It uses a single-owner lock, serialized transactions, prepare/commit WAL records, file and directory fsync where supported, atomic rename, SHA-256 integrity, deterministic schema rejection, retention caps, and clean signal shutdown.

Default limits include 250 blocks per log query, 2,000 bootstrap blocks, four chunks per pass, 2,000 pools, 5,000 canonical events, 256 relay events, 512 history records, 128 reconciliation records, 256 metadata jobs, and 64 SSE clients.

## Staging operations

Runtime entrypoints in the exact Actions artifact are `server.js` and `collector/run.mjs`. Use one unprivileged staging collector unit with a protected environment file and a writable staging-only `ONCHAIN_STORE_PATH`. The web and collector must use the same path. Do not put RPC values in a unit, repository, log, manifest, or evidence file.

Health is ready only when the integrity check is OK and the confirmed cursor is within the allowed lag. Pricing may degrade without stopping discovery. The health payload additionally reports enrichment depth/success/failure, exact provider matched/unmatched pools and reasons, circuits, last success, anchor state/provenance/freshness/deviation, tier counts, priced/ranked opportunities, price conflicts, and stale/dust rejections.

Historical acceptance uses `node collector/run.mjs --replay --block <exact-block> [--tx <exact-hash> --log-index <n>]`. It reuses the production decoder and binding checks but marks evidence as replay, emits no live SSE event, and does not advance the live cursor or add replay pools to the browser universe.

## Rollback

Before switching releases, retain the current release symlink target, web/collector unit hashes, protected-env hash, nginx hash, and a copy of the schema-v1 store. To roll back, stop only the staging web and collector units, atomically restore the prior release and its matching store snapshot, then start the staging collector followed by the staging web unit. Verify the deploy SHA, store digest/schema, collector cursor, web health, Basic Auth boundary, and both unit journals. Schema v1 is unchanged by this release; no production service or data path participates.
