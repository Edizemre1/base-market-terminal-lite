import { DurableDiscoveryStore } from "../../collector/store.mjs";

const directory = process.argv[2];
const head = Number.parseInt(process.argv[3] ?? "0", 10);
if (!directory || !Number.isSafeInteger(head) || head < 1) throw new Error("crash_worker_arguments_invalid");

const store = new DurableDiscoveryStore(directory, {
  checkpointIntervalMs: 24 * 60 * 60_000,
  checkpointTransactionLimit: 256,
  metricsLogger: null
});
let closing = false;

process.on("SIGTERM", async () => {
  if (closing) return;
  closing = true;
  await store.close();
  process.stdout.write("TERM_CLOSED\n", () => process.exit(0));
});

await store.open();
await store.transact("crash-fixture", (draft) => {
  draft.currentHead = head;
  draft.confirmedHead = head - 1;
}, undefined, { derive: false });
process.stdout.write("READY\n");
setInterval(() => {}, 60_000);
