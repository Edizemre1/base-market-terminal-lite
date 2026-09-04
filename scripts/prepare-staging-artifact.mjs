import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceSha = process.env.SOURCE_SHA?.trim();

if (!sourceSha || !/^[a-f0-9]{40}$/.test(sourceSha)) {
  throw new Error("SOURCE_SHA must be an exact 40-character lowercase Git commit SHA.");
}

const workspace = process.cwd();
const standalone = path.join(workspace, ".next", "standalone");
const outputRoot = path.join(workspace, ".artifacts");
const payload = path.join(outputRoot, "payload");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(payload, { recursive: true });
await cp(standalone, payload, { recursive: true, dereference: true });
await cp(path.join(workspace, "public"), path.join(payload, "public"), {
  recursive: true,
  dereference: true
});
await mkdir(path.join(payload, ".next"), { recursive: true });
await cp(path.join(workspace, ".next", "static"), path.join(payload, ".next", "static"), {
  recursive: true,
  dereference: true
});
await cp(path.join(workspace, "collector"), path.join(payload, "collector"), {
  recursive: true,
  dereference: true
});
await writeFile(path.join(payload, ".deploy-sha"), `${sourceSha}\n`, "utf8");

const files = await collectFiles(payload);
const manifestFiles = [];

for (const relativePath of files) {
  assertSafeArtifactPath(relativePath);
  const absolutePath = path.join(payload, ...relativePath.split("/"));
  const contents = await readFile(absolutePath);
  manifestFiles.push({
    path: relativePath,
    size: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex")
  });
}

const manifest = {
  schemaVersion: 1,
  sourceSha,
  runtimeContract: ">=20.0.0 <25",
  buildNode: process.version,
  runtimeEntrypoints: {
    web: "server.js",
    onchainCollector: "collector/run.mjs"
  },
  files: manifestFiles
};

await writeFile(
  path.join(payload, "artifact-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8"
);

console.log(`Prepared ${manifestFiles.length} files for ${sourceSha}.`);

async function collectFiles(root, current = "") {
  const directory = path.join(root, ...current.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = current ? `${current}/${entry.name}` : entry.name;
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink()) {
      throw new Error(`Artifact payload must not contain symlinks: ${relativePath}`);
    }

    if (stats.isDirectory()) {
      results.push(...(await collectFiles(root, relativePath)));
    } else if (stats.isFile()) {
      results.push(relativePath);
    }
  }

  return results.sort();
}

function assertSafeArtifactPath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");

  if (
    normalized.startsWith("/") ||
    normalized.split("/").includes("..") ||
    /(^|\/)\.env($|\.)/.test(normalized)
  ) {
    throw new Error(`Unsafe artifact path: ${relativePath}`);
  }
}
