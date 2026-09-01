import { keccak256Hex } from "./keccak.mjs";

export const BASE_CHAIN_ID = 8453;
export const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
export const BASE_WETH = "0x4200000000000000000000000000000000000006";
export const COLLECTOR_VERSION = "base-market-enrichment-v2";

const PROVENANCE = Object.freeze({
  aerodromeClassic: "https://github.com/aerodrome-finance/contracts#deployment",
  aerodromeSlipstream: "https://github.com/aerodrome-finance/slipstream#deployments",
  uniswapV2: "https://developers.uniswap.org/docs/protocols/v2/deployments",
  uniswapV3: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments",
  uniswapV4: "https://developers.uniswap.org/docs/protocols/v4/deployments",
  pancakeV2: "https://developer.pancakeswap.finance/contracts/v2/addresses",
  pancakeV3: "https://developer.pancakeswap.finance/contracts/v3/addresses",
  pancakeInfinity: "https://developer.pancakeswap.finance/contracts/infinity/resources/addresses"
});

const EVENT = Object.freeze({
  aerodromeClassic: "PoolCreated(address,address,bool,address,uint256)",
  aerodromeSlipstream: "PoolCreated(address,address,int24,address)",
  v2: "PairCreated(address,address,address,uint256)",
  v3: "PoolCreated(address,address,uint24,int24,address)",
  uniswapV4: "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)",
  pancakeInfinityCl: "Initialize(bytes32,address,address,address,uint24,bytes32,uint160,int24)",
  pancakeInfinityBin: "Initialize(bytes32,address,address,address,uint24,bytes32,uint24)"
});

const DEPLOYMENT = Object.freeze({
  "aerodrome-classic": [3200559, "0xe433b12037ad3730ffaf2ba609456381336738fb7748c3fdf308081ad237e555"],
  "aerodrome-slipstream-v1": [13843704, "0x653f75042fe42fb84e15fee5c7b7464c251c6f73d86d0ea414c0d5eb609ac71f"],
  "aerodrome-slipstream-v2": [36953918, "0x758692231333f13bf474c513c1261886ebce2554d8c1da1f909429b331b208d6"],
  "aerodrome-slipstream-v3": [44394724, "0xef9b902f3d9371c07cad14750b35ca755e6fe1fdd5b3ec160c8a61e321287e21"],
  "uniswap-v2": [6601915, "0x3c94031f81d9afe3beeb8fbcf4dcf1bd5b5688b86081d94e3d0231514dc00d31"],
  "uniswap-v3": [1371680, "0xedb18fb5d0bc873e137e19663251b3d1a3a9e276b095ca8bcf1ef4480c016f65"],
  "uniswap-v4": [25350988, "0x25f482fbd94cdea11b018732e455b8e9a940b933cabde3c0c5dd63ea65e85349"],
  "pancakeswap-v2": [2910387, "0x03d9ef592671d22fcd8dfb117d08cba4583bc0a3145eb811da46a3a4e6f5e091"],
  "pancakeswap-v3": [2912007, "0xd67deb086689166be5937d43c98e7dbd19ba852c8786c98c0cf98edf6f37327a"],
  "pancakeswap-infinity-cl": [30544106, "0x9e351442b37d4a5fb6e780385cee10837f7b1ad6db8c7db479fcda9f2be7ce76"],
  "pancakeswap-infinity-bin": [30544163, "0x918cbc88a37d421c58b8298398592d06e4ee9e3275a432dcc7f0c3aa1fbaedef"]
});

function capabilitiesFor(adapter) {
  if (adapter === "uniswap-v2") return Object.freeze({
    identityReadable: true,
    spotPriceReadable: true,
    reservesReadable: true,
    liquidityExactlyReadable: true,
    providerEnrichmentRequired: true
  });
  if (adapter === "aerodrome-classic") return Object.freeze({
    identityReadable: true,
    spotPriceReadable: false,
    reservesReadable: true,
    liquidityExactlyReadable: true,
    providerEnrichmentRequired: true
  });
  if (adapter === "uniswap-v3" || adapter === "aerodrome-slipstream") return Object.freeze({
    identityReadable: true,
    spotPriceReadable: true,
    reservesReadable: false,
    liquidityExactlyReadable: false,
    providerEnrichmentRequired: true
  });
  return Object.freeze({
    identityReadable: false,
    spotPriceReadable: false,
    reservesReadable: false,
    liquidityExactlyReadable: false,
    providerEnrichmentRequired: true
  });
}

function entry({ id, dexId, protocolVersion, address, eventSignature, poolType, provenanceUrl, adapter }) {
  const [deploymentStartBlock, creationTransactionHash] = DEPLOYMENT[id];
  return Object.freeze({
    id,
    chainId: BASE_CHAIN_ID,
    dexId,
    protocolVersion,
    address: address.toLowerCase(),
    eventSignature,
    eventTopic: keccak256Hex(eventSignature),
    poolType,
    deploymentStartBlock,
    creationTransactionHash,
    deploymentExplorerUrl: `https://basescan.org/tx/${creationTransactionHash}`,
    officialProvenanceUrl: provenanceUrl,
    enabled: true,
    confirmationPolicy: Object.freeze({ confirmations: 2, overlapBlocks: 16, maximumChunkBlocks: 250 }),
    adapterVersion: "1.0.0",
    adapter,
    capabilities: capabilitiesFor(adapter)
  });
}

// Exact creation blocks and transactions are resolved from BaseScan's contract
// creator provenance and verified against Base RPC. Runtime bootstrap remains
// bounded and does not scan full history on a public RPC without an explicit plan.
export const FACTORY_REGISTRY = Object.freeze([
  entry({ id: "aerodrome-classic", dexId: "aerodrome", protocolVersion: "classic", address: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da", eventSignature: EVENT.aerodromeClassic, poolType: "stable-or-volatile", provenanceUrl: PROVENANCE.aerodromeClassic, adapter: "aerodrome-classic" }),
  entry({ id: "aerodrome-slipstream-v1", dexId: "aerodrome", protocolVersion: "slipstream-v1", address: "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A", eventSignature: EVENT.aerodromeSlipstream, poolType: "concentrated-liquidity", provenanceUrl: PROVENANCE.aerodromeSlipstream, adapter: "aerodrome-slipstream" }),
  entry({ id: "aerodrome-slipstream-v2", dexId: "aerodrome", protocolVersion: "slipstream-v2", address: "0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a", eventSignature: EVENT.aerodromeSlipstream, poolType: "concentrated-liquidity", provenanceUrl: PROVENANCE.aerodromeSlipstream, adapter: "aerodrome-slipstream" }),
  entry({ id: "aerodrome-slipstream-v3", dexId: "aerodrome", protocolVersion: "slipstream-v3", address: "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef", eventSignature: EVENT.aerodromeSlipstream, poolType: "concentrated-liquidity", provenanceUrl: PROVENANCE.aerodromeSlipstream, adapter: "aerodrome-slipstream" }),
  entry({ id: "uniswap-v2", dexId: "uniswap", protocolVersion: "v2", address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6", eventSignature: EVENT.v2, poolType: "constant-product", provenanceUrl: PROVENANCE.uniswapV2, adapter: "uniswap-v2" }),
  entry({ id: "uniswap-v3", dexId: "uniswap", protocolVersion: "v3", address: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", eventSignature: EVENT.v3, poolType: "concentrated-liquidity", provenanceUrl: PROVENANCE.uniswapV3, adapter: "uniswap-v3" }),
  entry({ id: "uniswap-v4", dexId: "uniswap", protocolVersion: "v4", address: "0x498581ff718922c3f8e6a244956af099b2652b2b", eventSignature: EVENT.uniswapV4, poolType: "singleton-pool-id", provenanceUrl: PROVENANCE.uniswapV4, adapter: "uniswap-v4" }),
  entry({ id: "pancakeswap-v2", dexId: "pancakeswap", protocolVersion: "v2", address: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E", eventSignature: EVENT.v2, poolType: "constant-product", provenanceUrl: PROVENANCE.pancakeV2, adapter: "uniswap-v2" }),
  entry({ id: "pancakeswap-v3", dexId: "pancakeswap", protocolVersion: "v3", address: "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865", eventSignature: EVENT.v3, poolType: "concentrated-liquidity", provenanceUrl: PROVENANCE.pancakeV3, adapter: "uniswap-v3" }),
  entry({ id: "pancakeswap-infinity-cl", dexId: "pancakeswap", protocolVersion: "infinity-cl", address: "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b", eventSignature: EVENT.pancakeInfinityCl, poolType: "singleton-cl-pool-id", provenanceUrl: PROVENANCE.pancakeInfinity, adapter: "pancake-infinity" }),
  entry({ id: "pancakeswap-infinity-bin", dexId: "pancakeswap", protocolVersion: "infinity-bin", address: "0xC697d2898e0D09264376196696c51D7aBbbAA4a9", eventSignature: EVENT.pancakeInfinityBin, poolType: "singleton-bin-pool-id", provenanceUrl: PROVENANCE.pancakeInfinity, adapter: "pancake-infinity" })
]);

export function assertFactoryRegistry(registry = FACTORY_REGISTRY) {
  const ids = new Set();
  const bindings = new Set();
  for (const item of registry) {
    if (item.chainId !== BASE_CHAIN_ID) throw new Error(`Unexpected chain for ${item.id}`);
    if (!/^0x[0-9a-f]{40}$/.test(item.address)) throw new Error(`Invalid factory address for ${item.id}`);
    if (!/^0x[0-9a-f]{64}$/.test(item.eventTopic)) throw new Error(`Invalid event topic for ${item.id}`);
    if (!Number.isSafeInteger(item.deploymentStartBlock) || item.deploymentStartBlock <= 0) throw new Error(`Invalid deployment block for ${item.id}`);
    if (!/^0x[0-9a-f]{64}$/.test(item.creationTransactionHash)) throw new Error(`Invalid creation transaction for ${item.id}`);
    if (!item.officialProvenanceUrl.startsWith("https://")) throw new Error(`Missing official provenance for ${item.id}`);
    for (const capability of ["identityReadable", "spotPriceReadable", "reservesReadable", "liquidityExactlyReadable", "providerEnrichmentRequired"]) {
      if (typeof item.capabilities?.[capability] !== "boolean") throw new Error(`Missing ${capability} capability for ${item.id}`);
    }
    if (ids.has(item.id)) throw new Error(`Duplicate registry id: ${item.id}`);
    const binding = `${item.address}:${item.eventTopic}`;
    if (bindings.has(binding)) throw new Error(`Duplicate registry binding: ${binding}`);
    ids.add(item.id);
    bindings.add(binding);
  }
  return true;
}

assertFactoryRegistry();
