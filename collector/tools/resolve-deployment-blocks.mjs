import { FACTORY_REGISTRY } from "../factory-registry.mjs";

const explorerOrigin = process.env.BASE_EXPLORER_ORIGIN?.trim() || "https://basescan.org";
const rpcUrl = process.env.BASE_RPC_HTTP_URL?.trim() || "https://mainnet.base.org";

for (const entry of FACTORY_REGISTRY) {
  const response = await fetch(`${explorerOrigin}/address/${entry.address}`, {
    headers: { "user-agent": "BaseTerminalRegistryAudit/1.0 (+https://github.com/Edizemre1/base-market-terminal-lite)" }
  });
  if (!response.ok) throw new Error(`Explorer returned HTTP ${response.status} for ${entry.id}`);
  const html = await response.text();
  const creatorSection = html.match(/<!-- Contract Creator -->([\s\S]{0,3000}?)<!-- End Contract Creator -->/i)?.[1];
  const creationTransactionHash = creatorSection?.match(/href=["']\/tx\/(0x[0-9a-f]{64})/i)?.[1]?.toLowerCase();
  if (!creationTransactionHash) throw new Error(`Creation transaction not found for ${entry.id}`);
  const transaction = await rpc("eth_getTransactionByHash", [creationTransactionHash]);
  if (!transaction?.blockNumber) throw new Error(`Creation block not found for ${entry.id}`);
  process.stdout.write(`${JSON.stringify({
    id: entry.id,
    address: entry.address,
    deploymentStartBlock: Number.parseInt(transaction.blockNumber, 16),
    creationTransactionHash,
    explorerUrl: `${explorerOrigin}/tx/${creationTransactionHash}`
  })}\n`);
}

async function rpc(method, params) {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  });
  if (!response.ok) throw new Error(`RPC returned HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message ?? "RPC request failed");
  return payload.result;
}
