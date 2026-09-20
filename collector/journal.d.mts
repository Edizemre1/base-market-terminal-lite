export type JournalPatchOperation =
  | { op: "set"; path: Array<string | number>; value: unknown }
  | { op: "remove"; path: Array<string | number> };

export type JournalCursor<T extends object> = {
  state: T;
  sequence: number;
  digest: string;
  pending: Map<string, unknown>;
  ignoredLegacyRows: number;
};

export const JOURNAL_VERSION: 2;
export const MAX_PATCH_OPERATIONS: number;
export const MAX_PATCH_PATH_DEPTH: number;
export const MAX_PATCH_PATH_SEGMENT_BYTES: number;
export function createJournalCursor<T extends object>(state: T): JournalCursor<T>;
export function replayJournalChunk<T extends object>(cursor: JournalCursor<T>, input: string | Uint8Array, options?: { allowIncompleteTail?: boolean }): { consumedBytes: number; applied: number; incompleteBytes: number };
export function journalDigest(beforeDigest: string, payload: unknown): string;
export function journalPayload(row: Record<string, unknown>): Record<string, unknown>;
export function applyPatchOperations<T extends object>(state: T, operations: JournalPatchOperation[]): T;
export function validatePatch(operations: JournalPatchOperation[]): true;
export function stableStringify(value: unknown): string;
export function stableSha256(value: unknown): string;
