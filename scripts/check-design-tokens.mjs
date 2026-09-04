import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const sourceRoot = path.resolve("src");
const tokenFile = path.resolve("src/app/design-tokens.css");
const findings = [];
const sourceFiles = [];
const dynamicStyleExceptions = new Map([
  ["src/components/base-terminal/MarketSignalBadges.tsx", [/^style=\{\{ left: popoverPosition\.left, top: popoverPosition\.top, width: popoverPosition\.width, maxHeight: popoverPosition\.maxHeight \}\}$/]],
  ["src/components/base-terminal/AssetTradeabilityBadges.tsx", [/^style=\{\{ top: position\.top, left: position\.left, transform: position\.top > window\.innerHeight \/ 2 \? "translateY\(-100%\)" : undefined \}\}$/]]
]);

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(target);
    else if (/\.(?:css|ts|tsx)$/.test(entry.name)) sourceFiles.push(target);
  }
}

function check(file, source, label, pattern) {
  for (const match of source.matchAll(pattern)) {
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    findings.push(`${path.relative(process.cwd(), file)}:${line} ${label}: ${match[0]}`);
  }
}

function checkInlineStyles(file, source) {
  const relative = path.relative(process.cwd(), file).replaceAll("\\", "/");
  const allowlist = dynamicStyleExceptions.get(relative) ?? [];
  for (const match of source.matchAll(/style=\{\{[^\n]+\}\}/g)) {
    if (allowlist.some((pattern) => pattern.test(match[0]))) continue;
    const line = source.slice(0, match.index).split(/\r?\n/).length;
    findings.push(`${relative}:${line} unexplained inline style: ${match[0]}`);
  }
}

await walk(sourceRoot);

for (const file of sourceFiles) {
  if (file === tokenFile) continue;
  const source = await readFile(file, "utf8");
  check(file, source, "raw color", /#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\(\s*\d/gi);
  check(file, source, "non-semantic palette color", /(?<![\w-])(?:text|bg|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-\d{2,3})?(?:\/\d+)?\b/g);
  check(file, source, "raw product z-index", /(?<![\w-])z-(?:\d+|\[[^\]]+\])\b|z-index\s*:\s*\d+/g);
  check(file, source, "arbitrary spacing", /(?<![\w-])(?:[a-z0-9-]+:)*(?:gap|p[trblxy]?|m[trblxy]?|space-[xy])-\[[^\]]+\]/g);
  check(file, source, "off-scale spacing", /(?<![\w-])(?:[a-z0-9-]+:)*(?:gap|p[trblxy]?|m[trblxy]?|space-[xy])-(?:0\.5|1\.5|2\.5|5|7|9|10|11|12|14|16|20|24)\b/g);
  check(file, source, "non-semantic radius", /(?<![\w-])(?:[a-z0-9-]+:)*rounded(?:-[trbl]{1,2})?-(?:none|sm|md|lg|xl|2xl|3xl|full|\[[^\]]+\])/g);
  check(file, source, "non-semantic shadow/glow", /(?<![\w-])(?:[a-z0-9-]+:)*shadow-(?:sm|md|lg|xl|2xl|inner|glow|panel|\[[^\]]+\])/g);
  check(file, source, "primitive token access", /--primitive-[a-z0-9-]+/gi);
  check(file, source, "legacy color token", /(?:base-(?:black|panel|raised|elevated|line|text|muted|blue|electric|mint|cyan|amber|rose)|--color-[a-z0-9-]+)/gi);
  checkInlineStyles(file, source);
}

if (findings.length) {
  console.error(`Design token guard found ${findings.length} violation(s):\n${findings.join("\n")}`);
  process.exit(1);
}

console.log(`Design token guard GREEN (${sourceFiles.length} product source files checked).`);
