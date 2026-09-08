import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const tokens = await readFile(new URL("../src/app/design-tokens.css", import.meta.url), "utf8");
const components = await readFile(new URL("../src/components/ui/CalmComponents.tsx", import.meta.url), "utf8");
const config = await readFile(new URL("../tailwind.config.ts", import.meta.url), "utf8");
const dictionaries = await readFile(new URL("../src/i18n/dictionaries.ts", import.meta.url), "utf8");

test("primitive, semantic and component token layers are explicit", () => {
  assert.match(tokens, /Primitive: raw values/);
  assert.match(tokens, /Semantic: product meaning/);
  assert.match(tokens, /Component: purpose-named geometry/);
  assert.match(config, /"layer-a11y"/);
});

test("shared controls expose the required interaction states", () => {
  for (const state of ["hover:", "active:", "disabled:", "focus-visible:"]) assert.ok(components.includes(state));
  assert.match(components, /aria-busy/);
  assert.match(components, /h-control-s/);
  assert.match(components, /h-control-m/);
  assert.match(components, /h-control-touch/);
  for (const state of ["loading", "empty", "delayed", "stale", "unavailable", "error", "partial", "offline", "recovering"]) assert.match(components, new RegExp(`${state}:`));
});

test("canonical density and bilingual terminology remain available", () => {
  assert.match(dictionaries, /terminalV3\.density\.compact/);
  assert.match(dictionaries, /terminalV3\.density\.comfortable/);
  assert.match(dictionaries, /işlem rotası/);
  assert.match(dictionaries, /taze teklif/i);
});
