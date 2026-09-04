import { BASE_USDC, BASE_WETH } from "./factory-registry.mjs";
import { MAX_PRICE_AGE_MS } from "./model.mjs";
import { MARKET_QUALITY_THRESHOLDS } from "./market-quality.mjs";
import { resolveOnchainAdapter, validTokenDecimals } from "./onchain-state.mjs";

export function calculateProofFunnel(state, now = new Date()) {
  const nowMs = now.getTime();
  const cohort = new Set(state.proofCoverageCohort?.poolKeys ?? Object.keys(state.pools ?? {}));
  const pools = Object.values(state.pools ?? {}).filter(pool => cohort.has(pool.poolKey));
  const fresh = value => { const at=Date.parse(value??""); return Number.isFinite(at)&&at<=nowMs+5_000&&nowMs-at<=MAX_PRICE_AGE_MS; };
  const checks = [
    ["supportedAdapter", pool => Boolean(pool.poolAddress&&resolveOnchainAdapter(pool)), pool => pool.poolAddress?"unsupported_adapter":"pool_address_missing"],
    ["tokenIdentity", pool => pool.chainId===8453&&[pool.token0,pool.token1].every(token=>/^0x[0-9a-f]{40}$/.test(token??""))&&pool.token0!==pool.token1, () => "invalid_token_identity"],
    ["decimalsVerified", pool => [pool.token0,pool.token1].every(token=>validTokenDecimals(state.tokenMetadata?.[token]?.decimals)&&state.tokenMetadata[token].verificationState==="verified"), () => "token_metadata_unverified"],
    ["providerMatched", pool => pool.providerEnrichment?.status==="matched", pool => pool.providerEnrichment?.reasonCode??"provider_not_matched"],
    ["stateComplete", pool => pool.onchainState?.status==="complete", pool => pool.onchainState?.reasonCode??"state_missing"],
    ["stateFresh", pool => fresh(pool.onchainState?.observedAt), () => "state_stale_or_invalid"],
    ["providerPriceUsable", pool => Number.isFinite(pool.providerPriceToken1PerToken0)&&pool.providerPriceToken1PerToken0>0&&fresh(pool.marketObservedAt), pool => !fresh(pool.marketObservedAt)?"provider_stale_or_invalid":"provider_price_missing"],
    ["agreement", pool => pool.priceReconciliation?.status==="agreement"&&fresh(pool.priceReconciliation?.providerObservedAt)&&fresh(pool.priceReconciliation?.onchainObservedAt), pool => pool.priceReconciliation?.reasonCode??"agreement_missing"],
    ["liquidityUsable", pool => pool.liquidityResolutionState==="usable_liquidity"&&pool.liquidityUsd>=MARKET_QUALITY_THRESHOLDS.canonicalPriceMinimumLiquidityUsd, pool => pool.liquidityResolutionState??"liquidity_unknown"]
  ];
  let rows=pools;
  const stages=Object.fromEntries(checks.map(([name,pass,reason])=>{const entering=rows,passed=entering.filter(pass),dropped=entering.filter(pool=>!pass(pool));rows=passed;return [name,{entry:entering.length,pass:passed.length,drop:dropped.length,reasons:countBy(dropped,reason)}];}));
  const independent=Object.fromEntries(checks.map(([name,pass])=>[name,pools.filter(pass).length]));
  const anchorReady=state.priceAnchors?.wethUsdc?.status==="ready"&&fresh(state.priceAnchors.wethUsdc.observedAt);
  const opportunities=(state.opportunities??[]).filter(opportunity=>opportunity.poolKeys?.some(key=>cohort.has(key))||opportunity.canonicalPrice?.sourcePoolKeys?.some(key=>cohort.has(key)));
  const priced=opportunities.filter(opportunity=>["A","B","C"].includes(opportunity.canonicalPrice?.tier));
  const publishRejections=countBy(opportunities.filter(row=>row.canonicalPrice?.tier==="UNPRICED"),row=>row.canonicalPrice?.rejectionReason??row.canonicalPrice?.reasonCode??"unpriced");
  return {
    cohort:{capturedAt:state.proofCoverageCohort?.capturedAt,size:cohort.size,retained:pools.length,missing:cohort.size-pools.length},
    pool:{raw:pools.length,unique:new Set(pools.map(pool=>pool.poolKey)).size,stages,independent,
      intersections:{providerMatchedComplete:pools.filter(p=>p.providerEnrichment?.status==="matched"&&p.onchainState?.status==="complete").length,providerMatchedCompleteFresh:pools.filter(p=>p.providerEnrichment?.status==="matched"&&p.onchainState?.status==="complete"&&fresh(p.onchainState.observedAt)).length,providerMatchedCompleteFreshAgreement:pools.filter(p=>p.providerEnrichment?.status==="matched"&&p.onchainState?.status==="complete"&&fresh(p.onchainState.observedAt)&&p.priceReconciliation?.status==="agreement"&&fresh(p.priceReconciliation.providerObservedAt)).length,completeUsdc:pools.filter(p=>p.onchainState?.status==="complete"&&[p.token0,p.token1].includes(BASE_USDC)).length,completeWeth:pools.filter(p=>p.onchainState?.status==="complete"&&[p.token0,p.token1].includes(BASE_WETH)).length,completeAnchorReady:anchorReady?pools.filter(p=>p.onchainState?.status==="complete").length:0,liquidityUsablePriceValid:pools.filter(p=>p.liquidityResolutionState==="usable_liquidity"&&p.liquidityUsd>=MARKET_QUALITY_THRESHOLDS.canonicalPriceMinimumLiquidityUsd&&Number.isFinite(p.priceToken1PerToken0)&&p.priceToken1PerToken0>0).length}},
    opportunity:{count:opportunities.length,tiers:countBy(opportunities,row=>["A","B","C"].includes(row.canonicalPrice?.tier)?row.canonicalPrice.tier:"UNPRICED"),eligible:priced.length,published:priced.length,ranked:opportunities.filter(row=>row.rankingEligibility===true).length,eligibleNotPublished:0,publishRejections,topExclusionReasons:top(countBy(opportunities,row=>row.exclusionReason??row.canonicalPrice?.reasonCode??"unknown"))}
  };
}

function countBy(rows, selector){return rows.reduce((all,row)=>{const key=selector(row);all[key]=(all[key]??0)+1;return all;},{});}
function top(values){return Object.entries(values).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,10).map(([reasonCode,count])=>({reasonCode,count}));}
