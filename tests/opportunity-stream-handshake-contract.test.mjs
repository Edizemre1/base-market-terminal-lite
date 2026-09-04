import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("SSE handshake is flushed before durable snapshot verification", async () => {
  const source = await readFile("src/app/api/opportunity-stream/route.ts", "utf8");
  const retry = source.indexOf('controller.enqueue(encoder.encode("retry: 3000\\n\\n"))');
  const deferredPush = source.indexOf("initialPushTimer = setTimeout(push, 0)");
  assert.ok(retry >= 0);
  assert.ok(deferredPush > retry);
  assert.doesNotMatch(source, /controller\.enqueue\(encoder\.encode\("retry: 3000\\n\\n"\)\);\s*push\(\);/);
});
