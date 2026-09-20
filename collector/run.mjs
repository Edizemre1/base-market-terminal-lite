#!/usr/bin/env node
import { OnchainDiscoveryCollector, resolveCollectorConfig } from "./service.mjs";

const collector = new OnchainDiscoveryCollector(resolveCollectorConfig());
const abortController = new AbortController();
let closing = false;

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    abortController.abort();
  });
}

try {
  await collector.open();
  if (process.argv.includes("--once")) {
    const state = await collector.scanOnce();
    printSummary(state);
  } else if (process.argv.includes("--health")) {
    printSummary(collector.store.read());
  } else if (process.argv.includes("--replay")) {
    const blockNumber = Number.parseInt(readArgument("--block") ?? "", 10);
    const transactionHash = readArgument("--tx")?.toLowerCase();
    const logIndexValue = readArgument("--log-index");
    const logIndex = logIndexValue === undefined ? undefined : Number.parseInt(logIndexValue, 10);
    if (!Number.isSafeInteger(blockNumber) || blockNumber <= 0) throw new Error("--replay requires --block <positive integer>");
    if (transactionHash && !/^0x[0-9a-f]{64}$/.test(transactionHash)) throw new Error("--tx must be an exact transaction hash");
    const evidence = await collector.replayConfirmedEvent({ blockNumber, transactionHash, logIndex });
    console.log(JSON.stringify({ ok: true, replay: true, exactProvenance: evidence.exactProvenance, poolKey: evidence.pool.poolKey, opportunityCount: evidence.opportunities.length }));
  } else {
    await collector.run(abortController.signal);
  }
} finally {
  await collector.close();
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function printSummary(state) {
  console.log(JSON.stringify({
    ok: Boolean(state.health?.ready),
    mode: state.health?.mode,
    currentHead: state.currentHead,
    confirmedCursor: state.health?.confirmedCursor,
    lagBlocks: state.health?.lagBlocks,
    pools: Object.keys(state.pools ?? {}).length,
    opportunities: state.opportunities?.length ?? 0,
    duplicates: state.counters?.duplicateDropped ?? 0,
    malformed: state.counters?.malformedRejected ?? 0,
    storeIntegrity: state.health?.storeIntegrity,
    collectorVersion: state.collectorVersion
  }));
}
