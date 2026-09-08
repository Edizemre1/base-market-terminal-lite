import test from "node:test";
import assert from "node:assert/strict";
import { BASE_USDC, BASE_WETH } from "../collector/factory-registry.mjs";
import { buildCanonicalOpportunities, calculateCanonicalUsdcPrice } from "../collector/model.mjs";
import { calculateProofFunnel } from "../collector/proof-coverage.mjs";
import { RpcTransportPool } from "../collector/rpc-transport.mjs";
import { readPoolOnchainState, resolveOnchainPoolEvidence } from "../collector/onchain-state.mjs";
import { backfillPriority, recordBackfillOutcome, seedBackfillQueue, selectBackfillRpcBatch } from "../collector/pool-backfill.mjs";

const NOW=new Date("2026-09-04T18:00:00Z"), HASH=`0x${"a".repeat(64)}`, TOKEN=`0x${"1".repeat(40)}`;
function pool(key,token0=TOKEN,token1=BASE_USDC,rate=2,extra={}) { return {poolKey:key,poolAddress:`0x${key.padStart(40,"0").slice(-40)}`,chainId:8453,token0,token1,status:"confirmed",verifiedSource:true,factoryId:"uniswap-v2",factoryAddress:`0x${"f".repeat(40)}`,decimalsVerified:true,firstSeenAt:NOW.toISOString(),observedAt:NOW.toISOString(),liquidityUsd:10_000,onchainLiquidityUsd:10_000,liquidityResolutionState:"usable_liquidity",providerEnrichment:{status:"matched",providers:["dexscreener"],observedAt:NOW.toISOString()},priceReconciliation:{status:"agreement",deviation:0,providerObservedAt:NOW.toISOString(),onchainObservedAt:NOW.toISOString()},priceToken1PerToken0:rate,onchainState:{status:"complete",confidence:"exact_onchain_state",adapterFamily:"reserve_pool_state",token0,token1,decimals0:18,decimals1:token1===BASE_USDC?6:18,blockNumber:100,blockHash:HASH,observedAt:NOW.toISOString(),observedPrice0In1:rate,rawPriceRatio:{numerator:"2",denominator:"1"}},...extra}; }

test("canonical proof is exact, source-complete, chain-bound and never averages paths",()=>{
  const result=calculateCanonicalUsdcPrice(TOKEN,[pool("1",TOKEN,BASE_USDC,2),pool("2",TOKEN,BASE_USDC,2.1)],NOW);
  assert.equal(result.value,2); assert.equal(result.chainId,8453); assert.equal(result.tokenAddress,TOKEN);
  assert.equal(result.primaryPoolKey,"1"); assert.equal(result.adapterFamily,"reserve_pool_state"); assert.equal(result.inversionApplied,false);
  assert.deepEqual(result.rawPoolPrice,{numerator:"2",denominator:"1"}); assert.equal(result.sourceBlocks.length,2);
  assert.equal(result.eligible,true); assert.equal(result.expiresAt,"2026-09-04T18:02:00.000Z");
  assert.equal(calculateCanonicalUsdcPrice(TOKEN,[{...pool("1"),chainId:1}],NOW).rejectionReason,"wrong_chain");
});

test("Tier B binds exact token pool and exact fresh WETH anchor",()=>{
  const tokenPool=pool("1",TOKEN,BASE_WETH,0.01);
  const anchor=pool("2",BASE_WETH,BASE_USDC,2_000);
  const result=calculateCanonicalUsdcPrice(TOKEN,[tokenPool,anchor],NOW);
  assert.equal(result.tier,"B"); assert.equal(result.value,20); assert.equal(result.anchorPrice,2_000);
  assert.deepEqual(result.anchorPoolKeys,["2"]); assert.deepEqual(result.sourcePoolKeys,["1","2"]);
});

test("a stale sibling cannot reject a fully proved canonical path",()=>{
  const tokenPool=pool("1",TOKEN,BASE_WETH,0.01);
  const stale=pool("3",TOKEN,BASE_USDC,99,{observedAt:"2026-09-04T17:00:00Z",liquidityResolutionState:"stale_liquidity",onchainState:{...pool("x").onchainState,observedAt:"2026-09-04T17:00:00Z"}});
  const result=buildCanonicalOpportunities([tokenPool,stale,pool("2",BASE_WETH,BASE_USDC,2_000)],{[TOKEN]:{decimals:18,verificationState:"verified"},[BASE_WETH]:{decimals:18,verificationState:"verified"},[BASE_USDC]:{decimals:6,verificationState:"verified"}},[],NOW).find(row=>row.tokenAddress===TOKEN);
  assert.equal(result.canonicalPrice.tier,"B"); assert.equal(result.liquidityState,"usable_liquidity"); assert.notEqual(result.qualityBand,"REJECTED");
});

test("funnel separates pool and opportunity grain with exact intersections",()=>{
  const one=pool("1"), stale=pool("2",TOKEN,BASE_WETH,1,{onchainState:{...pool("x").onchainState,token1:BASE_WETH,observedAt:"2026-09-04T17:00:00Z"}});
  const state={pools:{1:one,2:stale},tokenMetadata:{[TOKEN]:{decimals:18,verificationState:"verified"},[BASE_USDC]:{decimals:6,verificationState:"verified"},[BASE_WETH]:{decimals:18,verificationState:"verified"}},proofCoverageCohort:{capturedAt:NOW.toISOString(),poolKeys:["1","2"]},priceAnchors:{wethUsdc:{status:"ready",observedAt:NOW.toISOString()}},opportunities:[{poolKeys:["1"],canonicalPrice:{tier:"A"},rankingEligibility:true}]};
  const funnel=calculateProofFunnel(state,NOW);
  assert.equal(funnel.pool.stages.stateComplete.pass,2); assert.equal(funnel.pool.independent.stateFresh,1);
  assert.equal(funnel.pool.intersections.providerMatchedCompleteFresh,1); assert.equal(funnel.opportunity.eligible,1); assert.equal(funnel.opportunity.ranked,1);
});

test("stale provider observations cannot manufacture live conflict or provider-only prices",()=>{
  const row=pool("1",TOKEN,BASE_USDC,2,{marketObservedAt:"2026-09-04T17:00:00Z",providerPriceToken1PerToken0:100,providerLiquidityUsd:50_000,providerEnrichment:{status:"matched",observedAt:"2026-09-04T17:00:00Z"}});
  const state={pools:{1:row},priceAnchors:{wethUsdc:{status:"unavailable"}}}; resolveOnchainPoolEvidence(state,NOW);
  assert.equal(row.priceReconciliation.status,"onchain_only"); assert.equal(row.priceReconciliation.reasonCode,"price_provider_stale");
  assert.equal(row.priceToken1PerToken0,2); assert.equal(row.liquidityReconciliation.reasonCode,"liquidity_unavailable_provider_stale");
});

test("priority value wins normal slots while bounded oldest and unproved slots remain fair",()=>{
  const state={pools:{},tokenMetadata:{[TOKEN]:{decimals:18,verificationState:"verified"},[BASE_USDC]:{decimals:6,verificationState:"verified"}},health:{}};
  const staleState={...pool("x").onchainState,observedAt:"2026-09-04T17:00:00Z"};
  state.pools["1"]=pool("1",TOKEN,BASE_USDC,2,{onchainState:staleState,providerLiquidityUsd:1_000_000,volume24hUsd:2_000_000,backfill:{nextAttemptAt:"2026-09-04T17:59:00Z",lastSuccessfulHash:HASH}});
  state.pools["2"]=pool("2",TOKEN,BASE_USDC,2,{onchainState:staleState,providerLiquidityUsd:1,volume24hUsd:0,backfill:{nextAttemptAt:"2026-09-04T17:59:00Z",lastSuccessfulHash:HASH}});
  state.pools["3"]=pool("3",TOKEN,BASE_USDC,2,{onchainState:staleState,providerEnrichment:{status:"unmatched"},backfill:{nextAttemptAt:"2026-09-04T10:00:00Z",lastSuccessfulHash:HASH}});
  state.pools["4"]=pool("4",TOKEN,BASE_USDC,2,{onchainState:undefined,backfill:{nextAttemptAt:"2026-09-04T17:59:00Z"}});
  seedBackfillQueue(state,NOW); assert.equal(state.onchainQueue[0].poolKey,"1");
  assert.equal(selectBackfillRpcBatch(state.onchainQueue,state.pools,4,0)[2].poolKey,"3");
  assert.equal(selectBackfillRpcBatch(state.onchainQueue,state.pools,4,0)[3].poolKey,"4");
  assert(backfillPriority(state.pools["1"],NOW,state.tokenMetadata)<backfillPriority(state.pools["3"],NOW,state.tokenMetadata));
  recordBackfillOutcome(state.pools["3"],{status:"retryable",reasonCode:"rpc_malformed_response"},NOW,{usedRpc:true}); assert(state.pools["3"].backfill.cooldownMs>=120_000);
});

test("verified immutable pool identity and token decimals are reused without identity RPC calls",async()=>{
  const row=pool("1"), evidence={status:"verified",poolAddress:row.poolAddress,token0:row.token0,token1:row.token1,factory:row.factoryAddress,factoryId:row.factoryId,verifiedAtBlockNumber:90,verifiedAtBlockHash:HASH}; let calls;
  const word=value=>BigInt(value).toString(16).padStart(64,"0");
  const rpc={batchOutcomes:async batch=>{calls=batch;return batch.map(call=>({ok:true,value:call.params[0].data==="0x0902f1ac"?`0x${word(1000)}${word(2000)}${word(1)}`:`0x${word(1000)}`}));}};
  const result=await readPoolOnchainState(rpc,row,{[TOKEN]:{decimals:18},[BASE_USDC]:{decimals:6}},{number:100,hash:HASH,observedAt:NOW.toISOString()},{identityEvidence:evidence});
  assert.equal(result.status,"complete"); assert.equal(result.identityCacheHit,true); assert.equal(result.tokenDecimalsCacheHits,2);
  assert.equal(calls.length,3); assert(!calls.some(call=>["0x0dfe1681","0xd21220a7","0xc45a0155"].includes(call.params[0].data)));
});

test("identical exact-block RPC batches coalesce, cache and report actual endpoint cost",async()=>{
  let wires=0; const fetchImpl=async(_url,{body})=>{wires++;const req=JSON.parse(body),rows=(Array.isArray(req)?req:[req]).map(row=>({jsonrpc:"2.0",id:row.id,result:row.method==="eth_chainId"?"0x2105":row.method==="eth_getBlockByNumber"?{number:row.params[0]==="latest"?"0x65":row.params[0],hash:HASH,timestamp:"0x64"}:`0x${"0".repeat(64)}`}));return new Response(JSON.stringify(rows),{status:200,headers:{"content-type":"application/json"}});};
  const transport=new RpcTransportPool([{label:"primary",url:"https://example.test"}],{fetchImpl,now:()=>101_000,minimumIntervalMs:0,endpointIntervalMs:0,delayImpl:async()=>{}});
  const rpc=transport.client({purpose:"pool_state"}),calls=[{method:"eth_call",params:[{to:`0x${"1".repeat(40)}`,data:"0x313ce567"},"0x64"]}],proof={number:100,hash:HASH,timestamp:100_000};
  await Promise.all([rpc.batchOutcomes(calls,{blockProof:proof}),rpc.batchOutcomes(calls,{blockProof:proof})]); const before=wires; await rpc.batchOutcomes(calls,{blockProof:proof});
  const metrics=rpc.circuitSnapshot(); assert.equal(wires,before); assert.equal(metrics.coalescingHits,1); assert.equal(metrics.cacheHits,1); assert.equal(metrics.byPurpose.pool_state.calls,4); assert.equal(metrics.endpoints[0].actualAttempts,1);
});
