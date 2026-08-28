import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

const [archiveArgument, expectedSha] = process.argv.slice(2);

if (!archiveArgument || !expectedSha || !/^[a-f0-9]{40}$/.test(expectedSha)) {
  throw new Error("Usage: node scripts/verify-staging-artifact.mjs <archive.tgz> <exact-sha>");
}

const archive = path.resolve(archiveArgument);
const verifyRoot = path.resolve(".artifacts", `verify-${process.pid}`);

try {
  const names = runTar(["-tzf", archive])
    .split(/\r?\n/)
    .filter(Boolean);
  const verboseEntries = runTar(["-tvzf", archive])
    .split(/\r?\n/)
    .filter(Boolean);

  for (const name of names) assertSafeArchivePath(name);
  if (verboseEntries.some((entry) => /^[lh]/.test(entry))) {
    throw new Error("Artifact archive contains a symlink or hard link.");
  }

  await rm(verifyRoot, { recursive: true, force: true });
  await mkdir(verifyRoot, { recursive: true });
  runTar(["-xzf", archive, "-C", verifyRoot, "--no-same-owner", "--no-same-permissions"]);

  const manifest = JSON.parse(
    await readFile(path.join(verifyRoot, "artifact-manifest.json"), "utf8")
  );
  if (manifest.sourceSha !== expectedSha) {
    throw new Error(`Manifest SHA mismatch: ${manifest.sourceSha}`);
  }

  const deploySha = (await readFile(path.join(verifyRoot, ".deploy-sha"), "utf8")).trim();
  if (deploySha !== expectedSha) {
    throw new Error(`Deploy marker mismatch: ${deploySha}`);
  }

  const actualFiles = (await collectFiles(verifyRoot)).filter(
    (relativePath) => relativePath !== "artifact-manifest.json"
  );
  const expectedFiles = new Map(
    manifest.files.map((file) => [file.path, { size: file.size, sha256: file.sha256 }])
  );

  if (actualFiles.length !== expectedFiles.size) {
    throw new Error(
      `Artifact inventory count mismatch: actual=${actualFiles.length} expected=${expectedFiles.size}`
    );
  }

  for (const relativePath of actualFiles) {
    assertSafeArchivePath(relativePath);
    const expected = expectedFiles.get(relativePath);
    if (!expected) throw new Error(`Unexpected artifact file: ${relativePath}`);

    const contents = await readFile(path.join(verifyRoot, ...relativePath.split("/")));
    const digest = createHash("sha256").update(contents).digest("hex");
    if (contents.byteLength !== expected.size || digest !== expected.sha256) {
      throw new Error(`Artifact file verification failed: ${relativePath}`);
    }
  }

  const archiveBytes = await readFile(archive);
  const archiveSha256 = createHash("sha256").update(archiveBytes).digest("hex");
  console.log(`Verified ${actualFiles.length} files for ${expectedSha}.`);
  console.log(`ARCHIVE_SHA256=${archiveSha256}`);
} finally {
  await rm(verifyRoot, { recursive: true, force: true });
}

function runTar(arguments_) {
  const result = spawnSync("tar", arguments_, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`tar ${arguments_.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout;
}

async function collectFiles(root, current = "") {
  const directory = path.join(root, ...current.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const results = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = current ? `${current}/${entry.name}` : entry.name;
    const absolutePath = path.join(root, ...relativePath.split("/"));
    const stats = await lstat(absolutePath);

    if (stats.isSymbolicLink()) throw new Error(`Extracted symlink: ${relativePath}`);
    if (stats.isDirectory()) results.push(...(await collectFiles(root, relativePath)));
    else if (stats.isFile()) results.push(relativePath);
  }

  return results.sort();
}

function assertSafeArchivePath(archivePath) {
  const normalized = archivePath.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!normalized || normalized === ".") return;

  if (
    normalized.startsWith("/") ||
    normalized.split("/").includes("..") ||
    /(^|\/)\.env($|\.)/.test(normalized)
  ) {
    throw new Error(`Unsafe artifact path: ${archivePath}`);
  }
}
