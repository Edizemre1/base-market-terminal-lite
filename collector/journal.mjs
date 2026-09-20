import { createHash } from "node:crypto";

export const JOURNAL_VERSION = 2;
export const MAX_PATCH_OPERATIONS = 16_384;
export const MAX_PATCH_PATH_DEPTH = 12;
export const MAX_PATCH_PATH_SEGMENT_BYTES = 256;

const FORBIDDEN_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export function createJournalCursor(state) {
  const sequence = safeSequence(state?.persistence?.appliedSequence);
  const digest = safeDigest(state?.persistence?.journalDigest) ?? safeDigest(state?.integrity?.digest);
  if (!digest) throw new Error("journal_base_digest_missing");
  return { state, sequence, digest, pending: new Map(), ignoredLegacyRows: 0 };
}

export function replayJournalChunk(cursor, input, { allowIncompleteTail = true } = {}) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? "", "utf8");
  const lastNewline = buffer.lastIndexOf(0x0a);
  const completeLength = lastNewline < 0 ? 0 : lastNewline + 1;
  if (!allowIncompleteTail && completeLength !== buffer.length) throw new Error("journal_torn_tail");
  const complete = buffer.subarray(0, completeLength).toString("utf8");
  const lines = complete.split(/\n/).filter(Boolean);
  let applied = 0;

  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); }
    catch { throw new Error("journal_corrupt_json"); }

    if (row?.journalVersion !== JOURNAL_VERSION) {
      cursor.ignoredLegacyRows += 1;
      continue;
    }
    if (row.type === "prepare") {
      validatePrepare(row);
      if (row.sequence > cursor.sequence) cursor.pending.set(row.transactionId, row);
      continue;
    }
    if (row.type !== "commit") throw new Error("journal_unknown_record");
    validateCommit(row);
    if (row.sequence <= cursor.sequence) {
      cursor.pending.delete(row.transactionId);
      continue;
    }
    if (row.sequence !== cursor.sequence + 1) throw new Error("journal_sequence_gap");
    const prepare = cursor.pending.get(row.transactionId);
    if (!prepare) throw new Error("journal_commit_without_prepare");
    if (prepare.sequence !== row.sequence || prepare.afterDigest !== row.afterDigest) throw new Error("journal_commit_mismatch");
    if (prepare.beforeDigest !== cursor.digest) throw new Error("journal_chain_mismatch");
    const expected = journalDigest(prepare.beforeDigest, journalPayload(prepare));
    if (expected !== prepare.afterDigest) throw new Error("journal_digest_mismatch");
    applyPatchOperations(cursor.state, prepare.patch);
    cursor.sequence = prepare.sequence;
    cursor.digest = prepare.afterDigest;
    cursor.pending.delete(row.transactionId);
    applied += 1;
  }

  return { consumedBytes: completeLength, applied, incompleteBytes: buffer.length - completeLength };
}

export function journalDigest(beforeDigest, payload) {
  if (!safeDigest(beforeDigest)) throw new Error("journal_before_digest_invalid");
  return createHash("sha256").update(beforeDigest).update("\n").update(stableStringify(payload)).digest("hex");
}

export function journalPayload(row) {
  return {
    journalVersion: JOURNAL_VERSION,
    transactionId: row.transactionId,
    sequence: row.sequence,
    at: row.at,
    reason: row.reason,
    patch: row.patch
  };
}

export function applyPatchOperations(state, operations) {
  validatePatch(operations);
  for (const operation of operations) {
    const parent = resolveParent(state, operation.path);
    const key = operation.path.at(-1);
    if (operation.op === "remove") {
      if (Array.isArray(parent) && isArrayIndex(key)) parent.splice(Number(key), 1);
      else delete parent[key];
      continue;
    }
    const value = structuredClone(operation.value);
    if (Array.isArray(parent) && key === "length") parent.length = value;
    else parent[key] = value;
  }
  return state;
}

export function validatePatch(operations) {
  if (!Array.isArray(operations) || operations.length > MAX_PATCH_OPERATIONS) throw new Error("journal_patch_count_invalid");
  for (const operation of operations) {
    if (!operation || (operation.op !== "set" && operation.op !== "remove")) throw new Error("journal_patch_operation_invalid");
    if (!Array.isArray(operation.path) || operation.path.length < 1 || operation.path.length > MAX_PATCH_PATH_DEPTH) throw new Error("journal_patch_path_invalid");
    for (const segment of operation.path) {
      if ((typeof segment !== "string" && !Number.isSafeInteger(segment)) || Buffer.byteLength(String(segment), "utf8") > MAX_PATCH_PATH_SEGMENT_BYTES || FORBIDDEN_SEGMENTS.has(String(segment))) {
        throw new Error("journal_patch_path_invalid");
      }
    }
    if (operation.op === "set" && !Object.hasOwn(operation, "value")) throw new Error("journal_patch_value_missing");
  }
  return true;
}

export function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function validatePrepare(row) {
  if (!validTransactionId(row.transactionId) || !Number.isSafeInteger(row.sequence) || row.sequence < 1 || typeof row.at !== "string" || typeof row.reason !== "string" || row.reason.length > 160) {
    throw new Error("journal_prepare_invalid");
  }
  if (!safeDigest(row.beforeDigest) || !safeDigest(row.afterDigest)) throw new Error("journal_prepare_digest_invalid");
  validatePatch(row.patch);
}

function validateCommit(row) {
  if (!validTransactionId(row.transactionId) || !Number.isSafeInteger(row.sequence) || row.sequence < 1 || !safeDigest(row.afterDigest)) throw new Error("journal_commit_invalid");
}

function resolveParent(state, path) {
  let current = state;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    if (!current || typeof current !== "object") throw new Error("journal_patch_parent_missing");
    if (!Object.hasOwn(current, segment)) {
      const next = path[index + 1];
      current[segment] = isArrayIndex(next) ? [] : {};
    }
    current = current[segment];
  }
  if (!current || typeof current !== "object") throw new Error("journal_patch_parent_missing");
  return current;
}

function isArrayIndex(value) {
  return Number.isSafeInteger(value) || (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value));
}

function validTransactionId(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function safeSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function safeDigest(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : undefined;
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}
