import { BASE_USDC, BASE_WETH, FACTORY_REGISTRY } from "./factory-registry.mjs";
import { MARKET_QUALITY_THRESHOLDS } from "./market-quality.mjs";
import { decodeAbiAddress, decodeAbiBigUint, decodeAbiUint, toHex } from "./rpc.mjs";

export const ONCHAIN_ADAPTER_VERSION = "2.0.0";
export const ONCHAIN_STATE_REFRESH_MS = 60_000;
export const ONCHAIN_STATE_MAX_AGE_MS = 2 * 60_000;
export const ONCHAIN_PRICE_MAX_DEVIATION = 0.15;
export const ONCHAIN_LIQUIDITY_MAX_DEVIATION = 0.5;
export const MAX_ONCHAIN_PRICE_HOPS = 3;

const SELECTOR = Object.freeze({
  token0: "0x0dfe1681",
  token1: "0xd21220a7",
  factory: "0xc45a0155",
  getReserves: "0x0902f1ac",
  slot0: "0x3850c7bd",
  liquidity: "0x1a686502",
  stable: "0x22be3de1",
  balanceOf: "0x70a08231"
});

const ADDRESS = /^0x[0-9a-f]{40}$/;
const SUCCESS = new Set(["complete", "observed"]);

export function resolveOnchainAdapter(pool) {
  const factoryId = pool?.factoryId;
  if (factoryId === "uniswap-v2" || factoryId === "pancakeswap-v2") {
    return { adapterFamily: "reserve_pool_state", protocolFamily: "uniswap_v2_compatible", kind: "v2", sourceMethod: "token0/token1/factory/getReserves/balanceOf" };
  }
  if (factoryId === "aerodrome-classic") {
    return { adapterFamily: "reserve_pool_state", protocolFamily: "aerodrome_classic", kind: "aerodrome-classic", sourceMethod: "token0/token1/factory/stable/getReserves/balanceOf" };
  }
  if (factoryId === "uniswap-v3" || factoryId === "pancakeswap-v3") {
    return { adapterFamily: "uniswap_v3_state", protocolFamily: factoryId === "pancakeswap-v3" ? "pancakeswap_v3_compatible" : "uniswap_v3_compatible", kind: "v3", sourceMethod: "token0/token1/factory/slot0/liquidity/balanceOf" };
  }
  if (typeof factoryId === "string" && factoryId.startsWith("aerodrome-slipstream")) {
    return { adapterFamily: "aerodrome_slipstream_state", protocolFamily: "aerodrome_slipstream", kind: "slipstream", sourceMethod: "token0/token1/factory/slot0/liquidity/balanceOf" };
  }
  return undefined;
}

export function unsupportedOnchainState(pool, now = new Date()) {
  const registry = FACTORY_REGISTRY.find((entry) => entry.id === pool?.factoryId);
  return {
    status: "unsupported",
    adapterVersion: ONCHAIN_ADAPTER_VERSION,
    adapterFamily: "unsupported",
    protocolFamily: registry?.adapter ?? "unknown",
    poolAddress: pool?.poolAddress,
    token0: pool?.token0,
    token1: pool?.token1,
    observedAt: now.toISOString(),
    sourceMethod: "registered_factory_capability",
    confidence: "unsupported",
    reasonCode: "unsupported_onchain_state",
    retryable: false
  };
}

export function validTokenDecimals(value) {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

export function exactPriceRatio(rawNumerator, rawDenominator, decimals0, decimals1) {
  if (typeof rawNumerator !== "bigint" || typeof rawDenominator !== "bigint" || rawNumerator <= 0n || rawDenominator <= 0n) {
    return { ok: false, reasonCode: "zero_or_invalid_price_input" };
  }
  if (!validTokenDecimals(decimals0) || !validTokenDecimals(decimals1)) return { ok: false, reasonCode: "invalid_decimals" };
  const numerator = rawNumerator * 10n ** BigInt(decimals0);
  const denominator = rawDenominator * 10n ** BigInt(decimals1);
  const direct = rationalToFiniteNumber(numerator, denominator);
  const inverted = rationalToFiniteNumber(denominator, numerator);
  if (direct === undefined || inverted === undefined) {
    return {
      ok: false,
      reasonCode: "precision_out_of_range",
      rawPrice0In1: { numerator: numerator.toString(), denominator: denominator.toString() },
      rawPrice1In0: { numerator: denominator.toString(), denominator: numerator.toString() }
    };
  }
  return {
    ok: true,
    observedPrice0In1: direct,
    observedPrice1In0: inverted,
    priceToken1PerToken0: direct,
    rawPrice0In1: { numerator: numerator.toString(), denominator: denominator.toString() },
    rawPrice1In0: { numerator: denominator.toString(), denominator: numerator.toString() },
    rawPriceRatio: { numerator: numerator.toString(), denominator: denominator.toString() },
    numericProjection: "finite_15_digit_projection"
  };
}

export async function readPoolOnchainState(rpc, pool, metadata = {}, block = {}, options = {}) {
  const adapter = resolveOnchainAdapter(pool);
  if (!adapter || !normalizeAddress(pool?.poolAddress)) return unsupportedOnchainState(pool, options.now ?? new Date());
  const now = options.now ?? new Date();
  const decimals0 = metadata[pool.token0]?.decimals;
  const decimals1 = metadata[pool.token1]?.decimals;
  const metadataFailure = metadataFailureReason(metadata[pool.token0], metadata[pool.token1]);
  if (!validTokenDecimals(decimals0) || !validTokenDecimals(decimals1)) {
    return stateBase(pool, adapter, block, now, {
      status: metadataFailure === "invalid_decimals" ? "rejected" : "pending",
      confidence: "unavailable",
      reasonCode: metadataFailure,
      retryable: metadataFailure !== "invalid_decimals"
    });
  }

  const tag = typeof block.number === "number" ? toHex(block.number) : block.tag ?? "latest";
  const calls = [
    ethCall(pool.poolAddress, SELECTOR.token0, tag, "token0"),
    ethCall(pool.poolAddress, SELECTOR.token1, tag, "token1"),
    ethCall(pool.poolAddress, SELECTOR.factory, tag, "factory")
  ];
  if (adapter.kind === "v2" || adapter.kind === "aerodrome-classic") calls.push(ethCall(pool.poolAddress, SELECTOR.getReserves, tag, "getReserves"));
  else {
    calls.push(ethCall(pool.poolAddress, SELECTOR.slot0, tag, "slot0"));
    calls.push(ethCall(pool.poolAddress, SELECTOR.liquidity, tag, "liquidity"));
  }
  if (adapter.kind === "aerodrome-classic") calls.push(ethCall(pool.poolAddress, SELECTOR.stable, tag, "stable"));
  calls.push(ethCall(pool.token0, balanceOfData(pool.poolAddress), tag, "balance0"));
  calls.push(ethCall(pool.token1, balanceOfData(pool.poolAddress), tag, "balance1"));

  const outcomes = await batchOutcomes(rpc, calls, options);
  const byLabel = new Map(outcomes.map((outcome, index) => [calls[index].label, outcome]));
  const requiredFailure = ["token0", "token1", "factory", adapter.kind === "v2" || adapter.kind === "aerodrome-classic" ? "getReserves" : "slot0"]
    .map((label) => [label, byLabel.get(label)])
    .find(([, outcome]) => !outcome?.ok);
  if (requiredFailure) {
    return stateBase(pool, adapter, block, now, {
      status: "retryable",
      confidence: "unavailable",
      reasonCode: normalizeOutcomeReason(requiredFailure[1], `${requiredFailure[0]}_read_failed`),
      failureMethod: requiredFailure[0],
      retryable: requiredFailure[1]?.retryable !== false
    });
  }

  const token0 = decodeAbiAddress(byLabel.get("token0").value);
  const token1 = decodeAbiAddress(byLabel.get("token1").value);
  const factory = byLabel.get("factory")?.ok ? decodeAbiAddress(byLabel.get("factory").value) : undefined;
  if (!token0 || !token1) return stateBase(pool, adapter, block, now, { status: "rejected", confidence: "rejected", reasonCode: "malformed_pool_identity", retryable: false });
  if (token0 !== pool.token0) return stateBase(pool, adapter, block, now, { status: "rejected", confidence: "rejected", reasonCode: "token0_mismatch", retryable: false, token0, token1, factory });
  if (token1 !== pool.token1) return stateBase(pool, adapter, block, now, { status: "rejected", confidence: "rejected", reasonCode: "token1_mismatch", retryable: false, token0, token1, factory });
  if (factory && factory !== pool.factoryAddress) return stateBase(pool, adapter, block, now, { status: "rejected", confidence: "rejected", reasonCode: "factory_mismatch", retryable: false, token0, token1, factory });

  const balance0 = byLabel.get("balance0")?.ok ? decodeAbiBigUint(byLabel.get("balance0").value) : undefined;
  const balance1 = byLabel.get("balance1")?.ok ? decodeAbiBigUint(byLabel.get("balance1").value) : undefined;
  const balanceFailures = ["balance0", "balance1"].flatMap((label) => byLabel.get(label)?.ok ? [] : [normalizeOutcomeReason(byLabel.get(label), `${label}_read_failed`)]);
  const common = stateBase(pool, adapter, block, now, {
    token0,
    token1,
    factory,
    decimals0,
    decimals1,
    orientation: "token0_to_token1",
    balanceEvidence: {
      balance0Raw: balance0?.toString(),
      balance1Raw: balance1?.toString(),
      sourceMethod: "erc20_balanceOf_pool"
    },
    failureReasons: balanceFailures
  });

  if (adapter.kind === "v2" || adapter.kind === "aerodrome-classic") {
    const reservesRaw = byLabel.get("getReserves").value;
    const reserve0 = decodeAbiBigUint(reservesRaw, 0);
    const reserve1 = decodeAbiBigUint(reservesRaw, 1);
    if (reserve0 === undefined || reserve1 === undefined) return { ...common, status: "rejected", confidence: "rejected", reasonCode: "malformed_reserves", retryable: false };
    const reserveEvidence = { reserve0Raw: reserve0.toString(), reserve1Raw: reserve1.toString(), sourceMethod: "getReserves" };
    if (reserve0 === 0n || reserve1 === 0n) return { ...common, status: "rejected", confidence: "rejected", reasonCode: "zero_liquidity", retryable: false, reserveEvidence, liquidityAmountsRaw: { amount0Raw: reserve0.toString(), amount1Raw: reserve1.toString(), sourceMethod: "getReserves" } };
    if (adapter.kind === "aerodrome-classic") {
      const stableOutcome = byLabel.get("stable");
      if (!stableOutcome?.ok) return { ...common, status: "retryable", confidence: "unavailable", reasonCode: normalizeOutcomeReason(stableOutcome, "stable_flag_read_failed"), retryable: stableOutcome?.retryable !== false, reserveEvidence };
      const stable = decodeAbiUint(stableOutcome.value);
      if (stable !== 0 && stable !== 1) return { ...common, status: "rejected", confidence: "rejected", reasonCode: "malformed_stable_flag", retryable: false, reserveEvidence };
      if (Boolean(stable)) return { ...common, status: "unsupported", confidence: "unsupported", reasonCode: "unsupported_stable_price_method", retryable: false, variant: "stable", reserveEvidence, liquidityAmountsRaw: { amount0Raw: reserve0.toString(), amount1Raw: reserve1.toString(), sourceMethod: "getReserves" } };
    }
    const price = exactPriceRatio(reserve1, reserve0, decimals0, decimals1);
    if (!price.ok) return { ...common, status: "rejected", confidence: "rejected", retryable: false, ...price, reserveEvidence };
    return {
      ...common,
      ...price,
      status: "complete",
      confidence: "exact_onchain_state",
      reasonCode: adapter.kind === "aerodrome-classic" ? "aerodrome_volatile_reserve_spot" : "v2_reserve_spot",
      retryable: false,
      variant: adapter.kind === "aerodrome-classic" ? "volatile" : undefined,
      reserveEvidence,
      liquidityAmountsRaw: { amount0Raw: reserve0.toString(), amount1Raw: reserve1.toString(), sourceMethod: "getReserves" }
    };
  }

  const sqrtPriceX96 = decodeAbiBigUint(byLabel.get("slot0").value, 0);
  const inRangeLiquidity = byLabel.get("liquidity")?.ok ? decodeAbiBigUint(byLabel.get("liquidity").value, 0) : undefined;
  if (!sqrtPriceX96 || sqrtPriceX96 <= 0n) return { ...common, status: "rejected", confidence: "rejected", reasonCode: "invalid_slot0", retryable: false };
  const price = exactPriceRatio(sqrtPriceX96 * sqrtPriceX96, 2n ** 192n, decimals0, decimals1);
  if (!price.ok) return { ...common, status: "rejected", confidence: "rejected", retryable: false, ...price, sqrtPriceX96: sqrtPriceX96.toString(), inRangeLiquidityRaw: inRangeLiquidity?.toString() };
  return {
    ...common,
    ...price,
    status: "complete",
    confidence: "exact_onchain_state",
    reasonCode: adapter.kind === "slipstream" ? "slipstream_slot0_spot" : "v3_slot0_spot",
    retryable: false,
    sqrtPriceX96: sqrtPriceX96.toString(),
    inRangeLiquidityRaw: inRangeLiquidity?.toString(),
    rawLiquiditySemantics: "in_range_not_usd",
    liquidityAmountsRaw: balance0 !== undefined && balance1 !== undefined ? { amount0Raw: balance0.toString(), amount1Raw: balance1.toString(), sourceMethod: "erc20_balanceOf_pool" } : undefined
  };
}

export function resolveOnchainPoolEvidence(state, now = new Date()) {
  const pools = Object.values(state.pools ?? {}).filter((pool) => pool.status === "confirmed" && !pool.orphaned && !pool.replay);
  const anchor = state.priceAnchors?.wethUsdc;
  const known = new Map([[BASE_USDC, { value: 1, hop: 0, source: "canonical_usdc_unit" }]]);
  if (freshAnchor(anchor, now)) known.set(BASE_WETH, { value: anchor.value, hop: 0, source: "weth_usdc_anchor" });
  const candidates = pools.flatMap((pool) => priceCandidate(pool, now) ? [{ pool, state: pool.onchainState }] : []);

  for (let hop = 1; hop <= MAX_ONCHAIN_PRICE_HOPS; hop += 1) {
    const proposed = new Map();
    for (const item of candidates) {
      const rate = item.state.observedPrice0In1 ?? item.state.priceToken1PerToken0;
      const known0 = known.get(item.pool.token0);
      const known1 = known.get(item.pool.token1);
      if (known0 && !known1) addKnownCandidate(proposed, item.pool.token1, known0.value / rate, item, known0.hop + 1, known0.value, undefined);
      if (known1 && !known0) addKnownCandidate(proposed, item.pool.token0, known1.value * rate, item, known1.hop + 1, undefined, known1.value);
    }
    let added = 0;
    for (const [token, values] of [...proposed.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      if (known.has(token)) continue;
      const accepted = values.filter((item) => item.hop <= hop && item.liquidityUsd >= MARKET_QUALITY_THRESHOLDS.canonicalPriceMinimumLiquidityUsd);
      if (!accepted.length) continue;
      const consensus = priceConsensus(accepted);
      if (!consensus) continue;
      known.set(token, { value: consensus.value, hop, source: "bounded_onchain_pool_graph" });
      added += 1;
    }
    if (!added) break;
  }

  for (const pool of pools) {
    const onchain = pool.onchainState;
    const onchainRate = SUCCESS.has(onchain?.status) ? positive(onchain.observedPrice0In1 ?? onchain.priceToken1PerToken0) : undefined;
    const providerRate = positive(pool.providerPriceToken1PerToken0) ?? providerPoolRate(pool);
    const priceReconciliation = {
      ...reconcileOnchainProviderValues(providerRate, onchainRate, ONCHAIN_PRICE_MAX_DEVIATION, "price"),
      providerObservedAt: pool.marketObservedAt ?? pool.providerEnrichment?.observedAt,
      onchainObservedAt: onchain?.observedAt,
      onchainBlockNumber: onchain?.blockNumber,
      onchainBlockHash: onchain?.blockHash
    };
    const amounts = onchain?.liquidityAmountsRaw;
    const price0 = known.get(pool.token0)?.value;
    const price1 = known.get(pool.token1)?.value;
    const onchainLiquidityUsd = onchainRate && amounts ? liquidityFromEvidence(amounts, onchain.decimals0, onchain.decimals1, price0, price1, onchainRate) : undefined;
    const providerLiquidityUsd = finiteNonNegative(pool.providerLiquidityUsd) ?? (pool.providerEnrichment?.status === "matched" ? finiteNonNegative(pool.liquidityUsd) : undefined);
    const liquidityReconciliation = {
      ...reconcileOnchainProviderValues(providerLiquidityUsd, onchainLiquidityUsd, ONCHAIN_LIQUIDITY_MAX_DEVIATION, "liquidity"),
      providerObservedAt: pool.marketObservedAt ?? pool.providerEnrichment?.observedAt,
      onchainObservedAt: onchain?.observedAt,
      onchainBlockNumber: onchain?.blockNumber
    };
    const onchainFreshness = onchainStateFreshness(onchain, now);
    const liquidityResolutionState = onchainFreshness === "stale" || onchainFreshness === "future"
      ? "stale_liquidity"
      : liquidityReconciliation.status === "conflict"
        ? "conflicting_liquidity"
        : classifyOnchainLiquidity(onchainLiquidityUsd ?? providerLiquidityUsd);
    const selectedRate = priceReconciliation.status === "conflict" ? undefined : onchainRate ?? providerRate;
    const selectedLiquidity = liquidityReconciliation.status === "conflict" || onchainFreshness === "stale" || onchainFreshness === "future" ? undefined : onchainLiquidityUsd ?? providerLiquidityUsd;
    const derivedPrices = onchainRate ? observedUsdPrices(pool, known, onchainRate) : {};
    Object.assign(pool, {
      providerPriceToken1PerToken0: providerRate,
      onchainPriceToken1PerToken0: onchainRate,
      priceToken1PerToken0: selectedRate,
      priceReconciliation,
      providerLiquidityUsd,
      onchainLiquidityUsd,
      liquidityUsd: selectedLiquidity,
      liquidityResolutionState,
      liquidityReconciliation,
      onchainObservedPricesUsd: derivedPrices,
      observedAt: onchainRate && onchainFreshness === "fresh" ? onchain.observedAt : pool.marketObservedAt ?? pool.observedAt
    });
  }
  return state;
}

export function acceptOnchainStateUpdate(previous, next) {
  if (!previous || !Number.isSafeInteger(previous.blockNumber) || !Number.isSafeInteger(next?.blockNumber)) return { accepted: true, reasonCode: "state_update" };
  if (next.blockNumber < previous.blockNumber) return { accepted: false, reasonCode: "out_of_order_state" };
  if (next.blockNumber === previous.blockNumber && previous.blockHash && next.blockHash && previous.blockHash !== next.blockHash) return { accepted: false, reasonCode: "state_block_hash_conflict" };
  if (next.blockNumber === previous.blockNumber && semanticStateValue(previous) === semanticStateValue(next)) return { accepted: false, reasonCode: "duplicate_state_snapshot" };
  return { accepted: true, reasonCode: "state_update" };
}

function stateBase(pool, adapter, block, now, extra = {}) {
  return {
    status: "pending",
    adapterVersion: ONCHAIN_ADAPTER_VERSION,
    adapterFamily: adapter.adapterFamily,
    protocolFamily: adapter.protocolFamily,
    poolAddress: pool.poolAddress,
    token0: pool.token0,
    token1: pool.token1,
    blockNumber: block.number,
    blockHash: block.hash,
    observedAt: block.observedAt ?? now.toISOString(),
    sourceMethod: adapter.sourceMethod,
    confidence: "unavailable",
    reasonCode: "pending_onchain_state",
    retryable: true,
    ...extra
  };
}

function metadataFailureReason(left, right) {
  if ([left, right].some((item) => item?.verificationState === "invalid" || item?.verificationState === "quarantined" || item?.failureReason === "invalid_decimals")) return "invalid_decimals";
  return "token_metadata_pending";
}

function ethCall(to, data, tag, label) {
  return { label, method: "eth_call", params: [{ to, data }, tag] };
}

function balanceOfData(address) {
  return `${SELECTOR.balanceOf}${address.slice(2).padStart(64, "0")}`;
}

async function batchOutcomes(rpc, calls, options) {
  if (typeof rpc?.batchOutcomes === "function") return rpc.batchOutcomes(calls.map(({ method, params }) => ({ method, params })), options);
  if (typeof rpc?.request === "function") return Promise.all(calls.map(async ({ method, params }) => {
    try { return { ok: true, value: await rpc.request(method, params, options) }; }
    catch (error) { return { ok: false, reasonCode: error?.reasonCode ?? "rpc_call_failed", retryable: error?.retryable !== false }; }
  }));
  if (typeof rpc?.call === "function") return Promise.all(calls.map(async ({ params }) => {
    try { return { ok: true, value: await rpc.call(params[0].to, params[0].data, params[1], options) }; }
    catch (error) { return { ok: false, reasonCode: error?.reasonCode ?? "rpc_call_failed", retryable: error?.retryable !== false }; }
  }));
  return calls.map(() => ({ ok: false, reasonCode: "rpc_client_unavailable", retryable: true }));
}

function normalizeOutcomeReason(outcome, fallback) {
  const reason = outcome?.reasonCode;
  if (typeof reason === "string" && reason) return reason;
  return fallback;
}

function priceCandidate(pool, now) {
  const onchain = pool?.onchainState;
  if (!SUCCESS.has(onchain?.status) || !positive(onchain.observedPrice0In1 ?? onchain.priceToken1PerToken0)) return false;
  if (onchainStateFreshness(onchain, now) !== "fresh") return false;
  if (pool.priceReconciliation?.status === "conflict") return false;
  return Boolean(onchain.liquidityAmountsRaw);
}

function addKnownCandidate(target, token, value, item, hop, knownPrice0, knownPrice1) {
  if (!positive(value)) return;
  const amounts = item.state.liquidityAmountsRaw;
  const rate = item.state.observedPrice0In1 ?? item.state.priceToken1PerToken0;
  const liquidityUsd = liquidityFromEvidence(amounts, item.state.decimals0, item.state.decimals1, knownPrice0, knownPrice1, rate);
  const rows = target.get(token) ?? [];
  rows.push({ value, liquidityUsd: liquidityUsd ?? 0, poolKey: item.pool.poolKey, hop });
  target.set(token, rows);
}

function priceConsensus(rows) {
  const ordered = [...rows].sort((left, right) => left.value - right.value || left.poolKey.localeCompare(right.poolKey));
  const median = ordered[Math.floor(ordered.length / 2)]?.value;
  const accepted = ordered.filter((item) => relativeDeviation(item.value, median) <= ONCHAIN_PRICE_MAX_DEVIATION);
  if (!accepted.length) return undefined;
  const weights = accepted.map((item) => Math.sqrt(Math.max(1, item.liquidityUsd)));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return { value: accepted.reduce((sum, item, index) => sum + item.value * weights[index], 0) / total };
}

function observedUsdPrices(pool, known, rate) {
  const price0 = known.get(pool.token0)?.value ?? (known.get(pool.token1)?.value ? known.get(pool.token1).value * rate : undefined);
  const price1 = known.get(pool.token1)?.value ?? (known.get(pool.token0)?.value ? known.get(pool.token0).value / rate : undefined);
  return Object.fromEntries([[pool.token0, price0], [pool.token1, price1]].filter(([, value]) => positive(value)));
}

function liquidityFromEvidence(amounts, decimals0, decimals1, knownPrice0, knownPrice1, rate) {
  if (!validTokenDecimals(decimals0) || !validTokenDecimals(decimals1)) return undefined;
  const raw0 = parseBigInt(amounts?.amount0Raw);
  const raw1 = parseBigInt(amounts?.amount1Raw);
  if (raw0 === undefined || raw1 === undefined) return undefined;
  let price0 = positive(knownPrice0);
  let price1 = positive(knownPrice1);
  if (!price0 && price1 && positive(rate)) price0 = price1 * rate;
  if (!price1 && price0 && positive(rate)) price1 = price0 / rate;
  if (!price0 || !price1) return undefined;
  const amount0 = scaledBigIntToNumber(raw0, decimals0);
  const amount1 = scaledBigIntToNumber(raw1, decimals1);
  const total = amount0 === undefined || amount1 === undefined ? undefined : amount0 * price0 + amount1 * price1;
  return finiteNonNegative(total);
}

export function reconcileOnchainProviderValues(provider, onchain, maximumDeviation, kind) {
  if (provider !== undefined && onchain !== undefined) {
    const deviation = relativeDeviation(provider, onchain);
    return { status: deviation > maximumDeviation ? "conflict" : "agreement", provider, onchain, deviation, maximumDeviation, reasonCode: deviation > maximumDeviation ? `${kind}_conflict` : `${kind}_agreement` };
  }
  if (onchain !== undefined) return { status: "onchain_only", onchain, maximumDeviation, reasonCode: `${kind}_onchain_only` };
  if (provider !== undefined) return { status: "provider_only", provider, maximumDeviation, reasonCode: `${kind}_provider_only` };
  return { status: "unavailable", maximumDeviation, reasonCode: `${kind}_unavailable` };
}

function providerPoolRate(pool) {
  const snapshots = [...(pool.providerSnapshots ?? [])].sort((left, right) => Date.parse(right.observedAt ?? right.receivedAt ?? "") - Date.parse(left.observedAt ?? left.receivedAt ?? ""));
  return positive(snapshots[0]?.priceToken1PerToken0);
}

export function classifyOnchainLiquidity(value) {
  if (value === undefined) return "liquidity_unknown";
  if (value === 0) return "zero_liquidity";
  return value >= MARKET_QUALITY_THRESHOLDS.canonicalPriceMinimumLiquidityUsd ? "usable_liquidity" : "thin_liquidity";
}

export function onchainStateFreshness(state, now) {
  const observed = Date.parse(state?.observedAt ?? "");
  if (!Number.isFinite(observed)) return "unknown";
  if (observed > now.getTime() + 5_000) return "future";
  return now.getTime() - observed <= ONCHAIN_STATE_MAX_AGE_MS ? "fresh" : "stale";
}

function freshAnchor(anchor, now) {
  if (anchor?.status !== "ready" || !positive(anchor.value)) return false;
  const observed = Date.parse(anchor.observedAt ?? "");
  return Number.isFinite(observed) && observed <= now.getTime() + 5_000 && now.getTime() - observed <= ONCHAIN_STATE_MAX_AGE_MS;
}

function rationalToFiniteNumber(numerator, denominator) {
  const numeratorText = numerator.toString();
  const denominatorText = denominator.toString();
  const exponent = numeratorText.length - denominatorText.length;
  if (exponent < -308 || exponent > 308) return undefined;
  const numeratorHead = Number(numeratorText.slice(0, 16));
  const denominatorHead = Number(denominatorText.slice(0, 16));
  const adjustedExponent = exponent - (Math.min(16, numeratorText.length) - Math.min(16, denominatorText.length));
  const value = numeratorHead / denominatorHead * 10 ** adjustedExponent;
  return positive(value);
}

function scaledBigIntToNumber(value, decimals) {
  if (value === 0n) return 0;
  return rationalToFiniteNumber(value, 10n ** BigInt(decimals));
}

function parseBigInt(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  try { return BigInt(value); } catch { return undefined; }
}

function relativeDeviation(value, reference) {
  return positive(value) && positive(reference) ? Math.abs(value / reference - 1) : Number.POSITIVE_INFINITY;
}

function positive(value) { return Number.isFinite(value) && value > 0 ? value : undefined; }
function finiteNonNegative(value) { return Number.isFinite(value) && value >= 0 ? value : undefined; }
function normalizeAddress(value) { const normalized = typeof value === "string" ? value.toLowerCase() : ""; return ADDRESS.test(normalized) ? normalized : undefined; }
function semanticStateValue(state) { return JSON.stringify({ status: state?.status, reasonCode: state?.reasonCode, rate: state?.rawPriceRatio, reserves: state?.reserveEvidence, balances: state?.balanceEvidence, sqrtPriceX96: state?.sqrtPriceX96, liquidity: state?.inRangeLiquidityRaw }); }
