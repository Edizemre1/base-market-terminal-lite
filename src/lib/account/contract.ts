export const MERGEN_PROFILE_CONTRACT_VERSION = 1 as const;

export const MERGEN_ACCOUNT_STATES = [
  "anonymous",
  "sign_in_required",
  "callback_pending",
  "authenticated",
  "session_expired",
  "profile_loading",
  "profile_ready",
  "profile_unavailable",
  "offline",
  "logged_out"
] as const;

export type MergenAccountState = (typeof MERGEN_ACCOUNT_STATES)[number];
export type MergenMembership = "free" | "pro";

export type CanonicalMergenProfile = Readonly<{
  version: typeof MERGEN_PROFILE_CONTRACT_VERSION;
  subject: string;
  email: string | null;
  displayName: string | null;
  memberSince: string;
  lastSignInAt: string | null;
  membership: MergenMembership;
}>;

export type CanonicalProfileClaimV1 = Readonly<{
  version: typeof MERGEN_PROFILE_CONTRACT_VERSION;
  email: string | null;
  display_name: string | null;
  member_since: string;
  last_sign_in_at: string | null;
  membership: MergenMembership;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function readCanonicalProfileClaim(subject: unknown, value: unknown): CanonicalMergenProfile | undefined {
  if (typeof subject !== "string" || !UUID_PATTERN.test(subject) || !isRecord(value)) return undefined;
  if (!hasExactKeys(value, ["version", "email", "display_name", "member_since", "last_sign_in_at", "membership"])) return undefined;
  if (value.version !== MERGEN_PROFILE_CONTRACT_VERSION) return undefined;
  const email = readNullableText(value.email, 320);
  const displayName = readNullableText(value.display_name, 60);
  const memberSince = readTimestamp(value.member_since);
  const lastSignInAt = readNullableTimestamp(value.last_sign_in_at);
  if (
    email === undefined ||
    email !== value.email ||
    displayName === undefined ||
    displayName !== value.display_name ||
    !memberSince ||
    memberSince !== value.member_since ||
    lastSignInAt === undefined ||
    lastSignInAt !== value.last_sign_in_at
  ) return undefined;
  if (value.membership !== "free" && value.membership !== "pro") return undefined;
  return Object.freeze({
    version: MERGEN_PROFILE_CONTRACT_VERSION,
    subject,
    email,
    displayName,
    memberSince,
    lastSignInAt,
    membership: value.membership
  });
}

export function profileDisplayName(profile: CanonicalMergenProfile): string {
  return profile.displayName || profile.email || "";
}

// This is the exact fallback algorithm used by the canonical mergen.finance profile.
export function profileInitials(name: string, email: string): string {
  const source = (name || email || "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]);
  return (letters.join("") || source[0]).toUpperCase();
}

function readNullableText(value: unknown, maximumLength: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maximumLength) return undefined;
  const normalized = value.trim();
  return normalized || null;
}

function readTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 40) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined;
}

function readNullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return readTimestamp(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
