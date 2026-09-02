import { BASE_CHAIN_ID, BASE_USDC, BASE_WETH } from "./factory-registry.mjs";

export const ENRICHMENT_QUEUE_LIMIT = 512;
export const ENRICHMENT_MAX_ATTEMPTS = 4;
export const PROVIDER_REFRESH_MS = 60_000;
export const UNMATCHED_REFRESH_MS = 10 * 60_000;
export const ANCHOR_REFRESH_MS = 30_000;
export const ANCHOR_VALIDATION_LIMIT = 3;
export const EXACT_LOOKUP_CACHE_MS = 30_000;
export const EXACT_LOOKUP_NEGATIVE_TTL_MS = 2 * 60_000;
export const PROVIDER_MINIMUM_INTERVAL_MS = Object.freeze({
  dexscreener: 210,
  geckoterminal: 6_000
});

const ADDRESS = /^0x[0-9a-f]{40}$/;
const DEXSCREENER = "https://api.dexscreener.com";
const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2";
const WINDOWS = ["m5", "h1", "h6", "h24"];

export class ProviderEnrichmentClient {
  constructor({ fetchImpl = globalThis.fetch, timeoutMs = 8_000, retries = 1, now = () => new Date(), delayImpl = delay } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.now = now;
    this.delayImpl = delayImpl;
    this.providerTimeoutMs = typeof timeoutMs === "number"
      ? { dexscreener: timeoutMs, geckoterminal: Math.min(12_000, Math.max(timeoutMs, 8_000)) }
      : { dexscreener: timeoutMs?.dexscreener ?? 8_000, geckoterminal: timeoutMs?.geckoterminal ?? 10_000 };
    // Leave two-thirds shared-IP headroom for other read-only GeckoTerminal
    // consumers while keeping this collector below the public 30 req/min limit.
    this.providerMinimumIntervalMs = { ...PROVIDER_MINIMUM_INTERVAL_MS };
    this.providerNextRequestAt = { dexscreener: 0, geckoterminal: 0 };
    this.exactLookupCache = new Map();
    this.exactLookupInFlight = new Map();
    this.circuits = {
      dexscreener: newCircuit(),
      geckoterminal: newCircuit()
    };
  }

  async lookupPool(poolAddress) {
    const address = normalizeAddress(poolAddress);
    if (!address) throw new ProviderRequestError("malformed_pool_address", { retryable: false });
    const nowMs = this.now().getTime();
    const cached = this.exactLookupCache.get(address);
    if (cached && cached.expiresAt > nowMs) return structuredClone({ ...cached.value, cacheHit: true });
    const pending = this.exactLookupInFlight.get(address);
    if (pending) return pending;
    const lookup = this.performExactPoolLookup(address).then((value) => {
      const ttl = value.lookupState === "not_found" ? EXACT_LOOKUP_NEGATIVE_TTL_MS : EXACT_LOOKUP_CACHE_MS;
      this.exactLookupCache.set(address, { expiresAt: this.now().getTime() + ttl, value });
      return structuredClone(value);
    }).finally(() => this.exactLookupInFlight.delete(address));
    this.exactLookupInFlight.set(address, lookup);
    return lookup;
  }

  async performExactPoolLookup(address) {
    const receivedAt = this.now().toISOString();
    const calls = [
      { kind: "dexscreener", promise: this.request("dexscreener", `${DEXSCREENER}/latest/dex/pairs/base/${address}`).then((payload) => parseDexScreenerPayload(payload, receivedAt)) },
      { kind: "geckoterminal", promise: this.request("geckoterminal", `${GECKOTERMINAL}/networks/base/pools/${address}?include=base_token,quote_token,dex`).then((payload) => parseGeckoTerminalPayload(payload, receivedAt)) }
    ];
    const settled = await Promise.allSettled(calls.map((call) => call.promise));
    const observations = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
    const providerFailures = settled.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (!observations.length && providerFailures.some((error) => error?.retryable)) {
      throw new ProviderRequestError("all_providers_transient_failure", { retryable: true });
    }
    let poolInfo;
    const failures = [...providerFailures];
    if (observations.length) {
      try {
        const payload = await this.request("geckoterminal", `${GECKOTERMINAL}/networks/base/pools/${address}/info`);
        poolInfo = parseGeckoTerminalInfo(payload, address, receivedAt);
      } catch (error) {
        failures.push(error);
      }
    }
    return { observations, poolInfo, lookupState: observations.length ? "found" : "not_found", receivedAt, failures: failures.map(safeFailure), circuits: this.circuitSnapshot(), cacheHit: false };
  }

  async lookupWethPools({ signal, poolAddresses } = {}) {
    const receivedAt = this.now().toISOString();
    const exactAddresses = [...new Set((poolAddresses ?? []).map(normalizeAddress).filter(Boolean))].slice(0, ANCHOR_VALIDATION_LIMIT);
    if (exactAddresses.length) {
      const settled = await Promise.allSettled(exactAddresses.map((address) => this.request(
        "dexscreener",
        `${DEXSCREENER}/latest/dex/pairs/base/${address}`,
        { signal }
      )));
      const observations = settled.flatMap((result) => result.status === "fulfilled" ? parseDexScreenerPayload(result.value, receivedAt) : []);
      const failures = settled.filter((result) => result.status === "rejected").map((result) => result.reason);
      if (!observations.length && failures.some((error) => error?.retryable)) {
        throw new ProviderRequestError("anchor_exact_lookup_transient_failure", { retryable: true, provider: "dexscreener" });
      }
      return observations
        .filter((pool) => exactAddresses.includes(pool.poolAddress) && tokenSetMatches(pool.baseTokenAddress, pool.quoteTokenAddress, BASE_WETH, BASE_USDC))
        .sort((left, right) => (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1) || left.poolAddress.localeCompare(right.poolAddress));
    }
    const payload = await this.request("dexscreener", `${DEXSCREENER}/token-pairs/v1/base/${BASE_WETH}`, { signal });
    return parseDexScreenerPayload(payload, receivedAt)
      .filter((pool) => tokenSetMatches(pool.baseTokenAddress, pool.quoteTokenAddress, BASE_WETH, BASE_USDC))
      .sort((left, right) => (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1) || left.poolAddress.localeCompare(right.poolAddress))
      .slice(0, 6);
  }

  circuitSnapshot() {
    return Object.fromEntries(Object.entries(this.circuits).map(([provider, circuit]) => [provider, {
      state: this.now().getTime() < circuit.openUntil ? "open" : "closed",
      consecutiveFailures: circuit.consecutiveFailures,
      openUntil: circuit.openUntil ? new Date(circuit.openUntil).toISOString() : undefined,
      lastSuccessAt: circuit.lastSuccessAt,
      lastFailureReason: circuit.lastFailureReason
    }]));
  }

  async request(provider, url, { signal } = {}) {
    const circuit = this.circuits[provider];
    if (this.now().getTime() < circuit.openUntil) throw new ProviderRequestError("provider_circuit_open", { retryable: true, provider });
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        await this.waitForProviderSlot(provider);
        const timeoutSignal = AbortSignal.timeout(this.providerTimeoutMs[provider] ?? 8_000);
        const response = await this.fetchImpl(url, {
          headers: { accept: "application/json", "user-agent": "Mergen-Base-Terminal/2.0" },
          signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
        });
        if (!response?.ok) {
          const status = Number(response?.status);
          throw new ProviderRequestError(`provider_http_${status || "invalid"}`, {
            retryable: status === 408 || status === 429 || status >= 500,
            provider,
            retryAfterMs: status === 429 ? readRetryAfterMs(response, this.now().getTime()) : undefined
          });
        }
        const payload = await response.json();
        circuit.consecutiveFailures = 0;
        circuit.openUntil = 0;
        circuit.lastSuccessAt = this.now().toISOString();
        circuit.lastFailureReason = undefined;
        return payload;
      } catch (error) {
        const normalized = normalizeProviderError(error, provider);
        circuit.lastFailureReason = normalized.reasonCode;
        if (normalized.reasonCode === "provider_http_429") {
          circuit.consecutiveFailures += 1;
          circuit.openUntil = Math.max(circuit.openUntil, this.now().getTime() + Math.max(60_000, normalized.retryAfterMs ?? 0));
          throw normalized;
        }
        if (!normalized.retryable || attempt === this.retries) {
          circuit.consecutiveFailures += 1;
          if (circuit.consecutiveFailures >= 5) circuit.openUntil = this.now().getTime() + 30_000;
          throw normalized;
        }
        await this.delayImpl(Math.min(2_000, 250 * 2 ** attempt));
      }
    }
    throw new ProviderRequestError("provider_retry_exhausted", { retryable: true, provider });
  }

  async waitForProviderSlot(provider) {
    const nowMs = this.now().getTime();
    const scheduledAt = Math.max(nowMs, this.providerNextRequestAt[provider] ?? 0);
    this.providerNextRequestAt[provider] = scheduledAt + (this.providerMinimumIntervalMs[provider] ?? 250);
    if (scheduledAt > nowMs) await this.delayImpl(scheduledAt - nowMs);
  }
}

export class ProviderRequestError extends Error {
  constructor(reasonCode, { retryable = false, provider, retryAfterMs } = {}) {
    super(reasonCode);
    this.name = "ProviderRequestError";
    this.reasonCode = reasonCode;
    this.retryable = retryable;
    this.provider = provider;
    this.retryAfterMs = retryAfterMs;
  }
}

export function parseDexScreenerPayload(payload, receivedAt = new Date().toISOString()) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.pairs) ? payload.pairs : [];
  return rows.flatMap((row) => {
    const poolAddress = normalizeAddress(row?.pairAddress);
    const baseTokenAddress = normalizeAddress(row?.baseToken?.address);
    const quoteTokenAddress = normalizeAddress(row?.quoteToken?.address);
    if (String(row?.chainId).toLowerCase() !== "base" || !poolAddress || !baseTokenAddress || !quoteTokenAddress) return [];
    return [providerObservation({
      provider: "dexscreener",
      poolAddress,
      baseTokenAddress,
      quoteTokenAddress,
      dexId: boundedText(row?.dexId, 80),
      priceNative: positive(row?.priceNative),
      priceUsd: positive(row?.priceUsd),
      liquidityUsd: nonNegative(row?.liquidity?.usd),
      volumes: numberWindows(row?.volume),
      transactions: transactionWindows(row?.txns),
      receivedAt,
      originalFields: {
        priceNative: "priceNative",
        priceUsd: "priceUsd",
        liquidityUsd: "liquidity.usd",
        volumes: "volume",
        transactions: "txns"
      }
    })];
  });
}

export function parseGeckoTerminalPayload(payload, receivedAt = new Date().toISOString()) {
  const data = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
  const included = new Map((Array.isArray(payload?.included) ? payload.included : []).map((row) => [String(row?.id ?? ""), row]));
  return data.flatMap((row) => {
    const attributes = row?.attributes ?? {};
    const relationships = row?.relationships ?? {};
    const base = included.get(String(relationships?.base_token?.data?.id ?? ""));
    const quote = included.get(String(relationships?.quote_token?.data?.id ?? ""));
    const poolAddress = normalizeAddress(attributes?.address) ?? normalizeAddress(String(row?.id ?? "").split("_").at(-1));
    const baseTokenAddress = normalizeAddress(base?.attributes?.address) ?? normalizeAddress(String(relationships?.base_token?.data?.id ?? "").split("_").at(-1));
    const quoteTokenAddress = normalizeAddress(quote?.attributes?.address) ?? normalizeAddress(String(relationships?.quote_token?.data?.id ?? "").split("_").at(-1));
    if (!poolAddress || !baseTokenAddress || !quoteTokenAddress) return [];
    return [providerObservation({
      provider: "geckoterminal",
      poolAddress,
      baseTokenAddress,
      quoteTokenAddress,
      dexId: boundedText(relationships?.dex?.data?.id, 80),
      priceNative: positive(attributes?.base_token_price_quote_token),
      priceUsd: positive(attributes?.base_token_price_usd),
      liquidityUsd: nonNegative(attributes?.reserve_in_usd),
      volumes: numberWindows(attributes?.volume_usd),
      transactions: transactionWindows(attributes?.transactions),
      receivedAt,
      originalFields: {
        priceNative: "attributes.base_token_price_quote_token",
        priceUsd: "attributes.base_token_price_usd",
        liquidityUsd: "attributes.reserve_in_usd",
        volumes: "attributes.volume_usd",
        transactions: "attributes.transactions"
      }
    })];
  });
}

export function parseGeckoTerminalInfo(payload, poolAddress, receivedAt = new Date().toISOString()) {
  const address = normalizeAddress(poolAddress);
  if (!address) return undefined;
  const rows = Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : [];
  const tokens = rows.flatMap((row) => {
    const attributes = row?.attributes ?? {};
    const tokenAddress = normalizeAddress(attributes.address) ?? normalizeAddress(String(row?.id ?? "").split("_").at(-1));
    if (!tokenAddress) return [];
    return [{ address: tokenAddress, name: boundedText(attributes.name, 160), symbol: boundedText(attributes.symbol, 80), sourceId: boundedText(row?.id, 220) }];
  });
  if (!tokens.length) return undefined;
  return {
    provider: "geckoterminal",
    poolAddress: address,
    indexedAt: receivedAt,
    tokens,
    source: "networks/base/pools/{pool_address}/info"
  };
}

export function joinExactProviderPools(pool, observations, { onchainState, now = new Date() } = {}) {
  const poolAddress = normalizeAddress(pool?.poolAddress);
  const token0 = normalizeAddress(pool?.token0);
  const token1 = normalizeAddress(pool?.token1);
  if (!poolAddress || !token0 || !token1) return { status: "rejected", reasonCode: "collector_identity_incomplete", retryable: false };
  const exact = observations.filter((item) => item.chainId === BASE_CHAIN_ID && item.poolAddress === poolAddress);
  if (!exact.length) return { status: "unmatched", reasonCode: "provider_pool_not_found", retryable: false, poolAddress };
  const accepted = [];
  const rejected = [];
  for (const item of exact) {
    if (!tokenSetMatches(token0, token1, item.baseTokenAddress, item.quoteTokenAddress)) {
      rejected.push({ provider: item.provider, reasonCode: "token_identity_conflict" });
      continue;
    }
    const orientation = item.baseTokenAddress === token0 && item.quoteTokenAddress === token1 ? "direct" : "inverted";
    const providerRate = orientation === "direct" ? item.priceNative : reciprocal(item.priceNative);
    accepted.push({ ...item, orientation, priceToken1PerToken0: providerRate });
  }
  if (!accepted.length) return { status: "conflicting", reasonCode: "token_identity_conflict", retryable: false, poolAddress, rejected };
  accepted.sort(compareObservations);
  const selected = accepted[0];
  const onchainRate = positive(onchainState?.priceToken1PerToken0);
  const priceToken1PerToken0 = onchainRate ?? positive(selected.priceToken1PerToken0);
  const providers = [...new Set(accepted.map((item) => item.provider))].sort();
  const observedAt = newestIso(accepted.map((item) => item.observedAt)) ?? now.toISOString();
  const observedPricesUsd = Object.fromEntries([token0, token1].flatMap((token) => {
    const candidates = accepted.flatMap((item) => {
      const value = item.baseTokenAddress === token
        ? positive(item.priceUsd)
        : item.quoteTokenAddress === token && positive(item.priceUsd) && positive(item.priceNative) ? item.priceUsd / item.priceNative : undefined;
      return positive(value) ? [{ value, item }] : [];
    }).sort((left, right) => compareObservations(left.item, right.item));
    return candidates[0] ? [[token, candidates[0].value]] : [];
  }));
  return {
    status: "matched",
    reasonCode: onchainRate ? onchainState.reasonCode : "exact_provider_pool_match",
    retryable: false,
    poolAddress,
    orientation: selected.orientation,
    providers,
    selectedProvider: selected.provider,
    observedAt,
    receivedAt: selected.receivedAt,
    priceToken1PerToken0,
    rawPriceRatio: onchainState?.rawPriceRatio,
    priceUsd: selected.priceUsd,
    observedPricesUsd,
    liquidityUsd: selected.liquidityUsd,
    volumes: selected.volumes,
    volume24hUsd: selected.volumes?.h24,
    transactions: selected.transactions,
    trades24h: transactionCount(selected.transactions?.h24),
    fieldProvenance: selected.fieldProvenance,
    providerSnapshots: accepted,
    rejected,
    onchainState
  };
}

export function resolveWethUsdcAnchor(candidates, now = new Date(), { maximumAgeMs = 2 * 60_000, minimumLiquidityUsd = 1_000, maximumDeviation = 0.03 } = {}) {
  const nowMs = now.getTime();
  const rejected = [];
  const accepted = [];
  for (const candidate of candidates ?? []) {
    const reasonCode = anchorRejection(candidate, nowMs, maximumAgeMs, minimumLiquidityUsd);
    if (reasonCode) rejected.push({ poolAddress: candidate.poolAddress, reasonCode });
    else accepted.push(candidate);
  }
  if (!accepted.length) return { status: "unavailable", reasonCode: dominantReason(rejected) ?? "no_verified_anchor_candidate", candidates: [], rejected, sourcePoolCount: 0, freshness: "unavailable" };
  const prices = accepted.map((item) => item.priceToken1PerToken0).sort((left, right) => left - right);
  const median = prices[Math.floor(prices.length / 2)];
  const inliers = accepted.filter((item) => Math.abs(item.priceToken1PerToken0 / median - 1) <= maximumDeviation);
  if (accepted.length > 1 && inliers.length < 2) {
    return { status: "degraded", reasonCode: "anchor_price_conflict", candidates: accepted, rejected, sourcePoolCount: accepted.length, freshness: "conflicting", deviation: relativeDeviation(prices) };
  }
  const consensus = inliers.length ? inliers : accepted;
  const rawWeights = consensus.map((item) => Math.sqrt(item.liquidityUsd));
  const orderedWeights = [...rawWeights].sort((left, right) => left - right);
  const medianWeight = orderedWeights[Math.floor(orderedWeights.length / 2)] || 1;
  const weights = rawWeights.map((weight) => Math.min(weight, medianWeight * 4));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const value = consensus.reduce((sum, item, index) => sum + item.priceToken1PerToken0 * weights[index], 0) / weightTotal;
  const selected = [...consensus].sort((left, right) => right.liquidityUsd - left.liquidityUsd || left.poolAddress.localeCompare(right.poolAddress))[0];
  const observedAt = oldestIso(consensus.map((item) => item.observedAt));
  const sourcePoolKeys = consensus.map((item) => item.poolAddress).sort();
  return {
    status: "ready",
    reasonCode: consensus.length > 1 ? "bounded_liquidity_consensus" : "single_verified_anchor_pool",
    value,
    rawValue: canonicalNumber(value),
    candidates: accepted,
    rejected,
    sourcePoolCount: consensus.length,
    selectedPool: selected.poolAddress,
    consensusPools: sourcePoolKeys,
    observedAt,
    freshness: "fresh",
    deviation: relativeDeviation(consensus.map((item) => item.priceToken1PerToken0)),
    pricingPool: {
      poolKey: selected.poolAddress,
      poolAddress: selected.poolAddress,
      token0: BASE_WETH,
      token1: BASE_USDC,
      status: "confirmed",
      verifiedSource: true,
      orphaned: false,
      observedAt,
      blockNumber: selected.blockNumber,
      priceToken1PerToken0: value,
      rawPriceRatio: selected.rawPriceRatio,
      liquidityUsd: Math.max(...consensus.map((item) => item.liquidityUsd)),
      volume24hUsd: selected.volume24hUsd,
      trades24h: selected.trades24h,
      providers: [...new Set(consensus.flatMap((item) => item.providers ?? []))].sort(),
      sourcePoolKeys,
      factoryId: selected.factoryId,
      factoryAddress: selected.factoryAddress,
      protocolVersion: selected.protocolVersion,
      anchorConsensus: true
    }
  };
}

export function stabilizeWethUsdcAnchorRefresh(current, candidate, completedAt = new Date(), { maximumAgeMs = 2 * 60_000, emptyRetryMs = 10_000 } = {}) {
  const completedMs = completedAt.getTime();
  const observedMs = Date.parse(current?.observedAt ?? "");
  const lastTrustedCandidates = current?.lastTrustedCandidates
    ?? (current?.status === "ready" ? current.candidates : undefined);
  const canRetain = candidate?.status === "unavailable"
    && candidate?.reasonCode === "no_verified_anchor_candidate"
    && current?.status === "ready"
    && Number.isFinite(observedMs)
    && completedMs >= observedMs
    && completedMs - observedMs <= maximumAgeMs;
  if (canRetain) {
    return {
      ...current,
      nextRefreshAt: new Date(completedMs + emptyRetryMs).toISOString(),
      lastRefreshReasonCode: candidate.reasonCode,
      refreshStatus: "retained_last_fresh",
      lastTrustedCandidates
    };
  }
  return {
    ...candidate,
    lastTrustedCandidates: candidate?.status === "ready" ? candidate.candidates : lastTrustedCandidates,
    nextRefreshAt: new Date(completedMs + ANCHOR_REFRESH_MS).toISOString()
  };
}

export function selectAnchorValidationCandidates(observations, maximum = ANCHOR_VALIDATION_LIMIT) {
  const byAddress = new Map();
  for (const observation of observations ?? []) {
    const address = normalizeAddress(observation?.poolAddress);
    if (!address || byAddress.has(address)) continue;
    byAddress.set(address, { ...observation, poolAddress: address });
  }
  return [...byAddress.values()]
    .sort((left, right) => (right.liquidityUsd ?? -1) - (left.liquidityUsd ?? -1) || left.poolAddress.localeCompare(right.poolAddress))
    .slice(0, Math.max(1, maximum));
}

export function coalesceEnrichmentQueue(existing, incoming, maximum = ENRICHMENT_QUEUE_LIMIT) {
  const queue = new Map();
  for (const item of [...(existing ?? []), ...(incoming ?? [])]) {
    const key = String(item?.poolKey ?? "").toLowerCase();
    if (!key) continue;
    const current = queue.get(key);
    queue.set(key, current && (current.priority ?? 0) >= (item.priority ?? 0) ? current : { ...current, ...item, poolKey: key });
  }
  return [...queue.values()]
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || (left.createdAt ?? "").localeCompare(right.createdAt ?? "") || left.poolKey.localeCompare(right.poolKey))
    .slice(0, Math.max(1, maximum));
}

export function nextRetryAt(attempts, now = new Date()) {
  const bounded = Math.min(5 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + bounded).toISOString();
}

function providerObservation(input) {
  const fieldProvenance = Object.fromEntries(Object.entries(input.originalFields).map(([normalizedField, originalField]) => [normalizedField, {
    provider: input.provider,
    poolAddress: input.poolAddress,
    observedAt: input.receivedAt,
    receivedAt: input.receivedAt,
    freshness: "fresh",
    originalField,
    normalizedField,
    rejectionReason: undefined
  }]));
  return { ...input, chainId: BASE_CHAIN_ID, observedAt: input.receivedAt, freshness: "fresh", fieldProvenance };
}

function anchorRejection(candidate, nowMs, maximumAgeMs, minimumLiquidityUsd) {
  if (!candidate?.registeredFactory) return "unregistered_factory";
  if (!candidate.decimalsVerified) return "invalid_decimals";
  if (!tokenSetMatches(candidate.token0, candidate.token1, BASE_WETH, BASE_USDC)) return "anchor_token_identity_conflict";
  if (!Number.isFinite(candidate.priceToken1PerToken0) || candidate.priceToken1PerToken0 <= 0) return "invalid_anchor_price";
  if (!Number.isFinite(candidate.liquidityUsd) || candidate.liquidityUsd < minimumLiquidityUsd) return "dust_anchor_liquidity";
  const observed = Date.parse(candidate.observedAt ?? "");
  if (!Number.isFinite(observed)) return "invalid_anchor_timestamp";
  if (observed > nowMs + 5_000) return "future_anchor_timestamp";
  if (nowMs - observed > maximumAgeMs) return "stale_anchor";
  return undefined;
}

function compareObservations(left, right) {
  return observationCompleteness(right) - observationCompleteness(left)
    || Date.parse(right.observedAt) - Date.parse(left.observedAt)
    || Number(right.provider === "geckoterminal") - Number(left.provider === "geckoterminal")
    || left.provider.localeCompare(right.provider);
}

function observationCompleteness(value) {
  return [value.priceNative, value.priceUsd, value.liquidityUsd, value.volumes?.m5, value.volumes?.h1, value.volumes?.h24, value.transactions?.h24]
    .filter((item) => item !== undefined).length;
}

function numberWindows(value) {
  const record = value && typeof value === "object" ? value : {};
  return Object.fromEntries(WINDOWS.flatMap((window) => {
    const parsed = nonNegative(record[window]);
    return parsed === undefined ? [] : [[window, parsed]];
  }));
}

function transactionWindows(value) {
  const record = value && typeof value === "object" ? value : {};
  return Object.fromEntries(WINDOWS.flatMap((window) => {
    const row = record[window];
    const buys = nonNegative(row?.buys);
    const sells = nonNegative(row?.sells);
    return buys === undefined || sells === undefined ? [] : [[window, { buys, sells }]];
  }));
}

function transactionCount(value) { return value && Number.isFinite(value.buys) && Number.isFinite(value.sells) ? value.buys + value.sells : undefined; }
function tokenSetMatches(left0, left1, right0, right1) { return left0 === right0 && left1 === right1 || left0 === right1 && left1 === right0; }
function normalizeAddress(value) { const normalized = typeof value === "string" ? value.trim().toLowerCase() : ""; return ADDRESS.test(normalized) ? normalized : undefined; }
function positive(value) { const parsed = finite(value); return parsed !== undefined && parsed > 0 ? parsed : undefined; }
function nonNegative(value) { const parsed = finite(value); return parsed !== undefined && parsed >= 0 ? parsed : undefined; }
function finite(value) { if (typeof value === "string" && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return undefined; const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN; return Number.isFinite(parsed) ? parsed : undefined; }
function reciprocal(value) { return Number.isFinite(value) && value > 0 ? 1 / value : undefined; }
function boundedText(value, maximum) { const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : ""; return text ? text.slice(0, maximum) : undefined; }
function newestIso(values) { return values.filter((value) => Number.isFinite(Date.parse(value))).sort().at(-1); }
function oldestIso(values) { return values.filter((value) => Number.isFinite(Date.parse(value))).sort()[0]; }
function canonicalNumber(value) { return Number.isFinite(value) && value > 0 ? value.toPrecision(15) : undefined; }
function relativeDeviation(values) { if (!values.length) return undefined; const minimum = Math.min(...values); const maximum = Math.max(...values); const middle = (minimum + maximum) / 2; return middle > 0 ? (maximum - minimum) / middle : undefined; }
function dominantReason(rejected) { return rejected.map((item) => item.reasonCode).sort()[0]; }
function safeFailure(error) { return { provider: error?.provider, reasonCode: error?.reasonCode ?? "provider_failure", retryable: Boolean(error?.retryable) }; }
function normalizeProviderError(error, provider) { if (error instanceof ProviderRequestError) return error; const timeout = error?.name === "TimeoutError" || error?.name === "AbortError"; return new ProviderRequestError(timeout ? "provider_timeout" : "provider_network_failure", { retryable: true, provider }); }
function readRetryAfterMs(response, nowMs) {
  const value = response?.headers?.get?.("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - nowMs;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? Math.min(5 * 60_000, Math.max(1_000, milliseconds)) : undefined;
}
function newCircuit() { return { consecutiveFailures: 0, openUntil: 0, lastSuccessAt: undefined, lastFailureReason: undefined }; }
function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
