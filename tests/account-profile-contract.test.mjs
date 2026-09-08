import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MERGEN_ACCOUNT_STATES,
  MERGEN_PROFILE_MAX_UTF8_BYTES,
  readCanonicalProfileClaim,
  profileInitials
} from "../src/lib/account/contract.ts";
import { en, tr } from "../src/i18n/dictionaries.ts";

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");
const utf8Bytes = (value) => new TextEncoder().encode(value).byteLength;
const SUBJECT = "123e4567-e89b-42d3-a456-426614174000";
const BASE_CLAIM = Object.freeze({
  version: 1,
  email: "member@example.com",
  display_name: "Mergen Member",
  member_since: "2025-01-02T03:04:05.000Z",
  last_sign_in_at: "2026-08-30T10:00:00.000Z",
  membership: "pro"
});
const claim = (overrides = {}) => ({ ...BASE_CLAIM, ...overrides });
const readProfile = (overrides = {}) => readCanonicalProfileClaim(SUBJECT, claim(overrides));

test("canonical profile uses provider code-point and UTF-8 boundaries for astral Unicode", () => {
  const displayName = "😀".repeat(31);
  assert.equal([...displayName].length, 31);
  assert.equal(utf8Bytes(displayName), 124);
  assert.equal(displayName.length, 62);
  assert.equal(readProfile({ display_name: displayName })?.displayName, displayName);

  const exactLimit = "😀".repeat(60);
  assert.equal([...exactLimit].length, 60);
  assert.equal(utf8Bytes(exactLimit), 240);
  assert.equal(readProfile({ display_name: exactLimit })?.displayName, exactLimit);

  const overLimit = "😀".repeat(61);
  assert.equal([...overLimit].length, 61);
  assert.equal(utf8Bytes(overLimit), 244);
  assert.equal(readProfile({ display_name: overLimit }), undefined);
});

test("canonical profile requires NFC and rejects the provider unsafe Unicode categories", () => {
  for (const displayName of ["Çağrı 🚀", "Café", "İpek Şahin"]) {
    assert.equal(displayName.normalize("NFC"), displayName);
    assert.equal(readProfile({ display_name: displayName })?.displayName, displayName);
  }

  const decomposed = "Cafe\u0301";
  assert.equal(decomposed.normalize("NFC"), "Café");
  assert.equal(readProfile({ display_name: decomposed }), undefined);

  const unsafeCharacters = [
    "\u0000",
    "\r\n",
    "\u0085",
    "\u200B",
    "\u2028",
    "\u202E",
    "\u2066",
    "\u2029",
    String.fromCharCode(0xd800)
  ];
  for (const unsafeCharacter of unsafeCharacters) {
    assert.equal(readProfile({ display_name: `Mergen${unsafeCharacter}Member` }), undefined);
  }
});

test("canonical profile mirrors provider field and aggregate UTF-8 boundaries", () => {
  assert.equal(MERGEN_PROFILE_MAX_UTF8_BYTES, 2_048);

  const maximumFieldValidClaim = claim({
    email: "😀".repeat(320),
    display_name: "😀".repeat(60),
    membership: "free"
  });
  assert.equal([...maximumFieldValidClaim.email].length, 320);
  assert.equal(utf8Bytes(maximumFieldValidClaim.email), 1_280);
  assert.equal(utf8Bytes(maximumFieldValidClaim.display_name), 240);
  assert.equal(utf8Bytes(JSON.stringify(maximumFieldValidClaim)), 1_669);
  assert.ok(readCanonicalProfileClaim(SUBJECT, maximumFieldValidClaim));

  const oneByteOverEmail = `${maximumFieldValidClaim.email}a`;
  assert.equal([...oneByteOverEmail].length, 321);
  assert.equal(utf8Bytes(oneByteOverEmail), 1_281);
  assert.equal(utf8Bytes(JSON.stringify({ ...maximumFieldValidClaim, email: oneByteOverEmail })), 1_670);
  assert.equal(readProfile({ email: oneByteOverEmail, display_name: "😀".repeat(60), membership: "free" }), undefined);

  // The provider's per-field ceilings make a valid 2,048-byte profile unreachable.
  // These exact-size fixtures are rejected by both sides at the earlier email ceiling.
  const atAggregateLimit = claim({ email: "a".repeat(1_839), display_name: "d".repeat(60), membership: "free" });
  const overAggregateLimit = claim({ email: "a".repeat(1_840), display_name: "d".repeat(60), membership: "free" });
  assert.equal(utf8Bytes(JSON.stringify(atAggregateLimit)), MERGEN_PROFILE_MAX_UTF8_BYTES);
  assert.equal(utf8Bytes(JSON.stringify(overAggregateLimit)), MERGEN_PROFILE_MAX_UTF8_BYTES + 1);
  assert.equal(readCanonicalProfileClaim(SUBJECT, atAggregateLimit), undefined);
  assert.equal(readCanonicalProfileClaim(SUBJECT, overAggregateLimit), undefined);
});

test("canonical account states and profile claim are exact", () => {
  assert.deepEqual(MERGEN_ACCOUNT_STATES, [
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
  ]);
  const validClaim = claim();
  assert.deepEqual(readCanonicalProfileClaim(SUBJECT, validClaim), {
    version: 1,
    subject: SUBJECT,
    email: "member@example.com",
    displayName: "Mergen Member",
    memberSince: "2025-01-02T03:04:05.000Z",
    lastSignInAt: "2026-08-30T10:00:00.000Z",
    membership: "pro"
  });
  assert.equal(readCanonicalProfileClaim("wallet-address", validClaim), undefined);
  assert.equal(readCanonicalProfileClaim("123E4567-E89B-42D3-A456-426614174000", validClaim), undefined);
  assert.equal(readProfile({ display_name: " Mergen Member " }), undefined);
  assert.equal(readProfile({ display_name: "" }), undefined);
  assert.equal(readProfile({ member_since: "2025-01-02" }), undefined);
  assert.equal(readProfile({ last_sign_in_at: "2026-08-30T10:00:00Z" }), undefined);
  assert.equal(readCanonicalProfileClaim(SUBJECT, { ...validClaim, handle: "invented" }), undefined);
  assert.equal(readProfile({ version: 2 }), undefined);
  assert.equal(readProfile({ membership: "admin" }), undefined);

  for (const key of Object.keys(validClaim)) {
    const incompleteClaim = { ...validClaim };
    delete incompleteClaim[key];
    assert.equal(readCanonicalProfileClaim(SUBJECT, incompleteClaim), undefined, key);
  }

  const nullableProfile = readProfile({
    email: null,
    display_name: null,
    last_sign_in_at: null,
    membership: "free"
  });
  assert.equal(nullableProfile?.email, null);
  assert.equal(nullableProfile?.displayName, null);
  assert.equal(nullableProfile?.lastSignInAt, null);
  assert.equal(nullableProfile?.membership, "free");
});

test("avatar fallback matches the canonical Mergen initials algorithm", () => {
  assert.equal(profileInitials("Ada Lovelace", "ada@example.com"), "AL");
  assert.equal(profileInitials("", "member@example.com"), "ME");
  assert.equal(profileInitials("", ""), "?");
});

test("canonical account copy has exact TR/EN key parity", () => {
  const englishKeys = Object.keys(en).filter((key) => key.startsWith("account.")).sort();
  const turkishKeys = Object.keys(tr).filter((key) => key.startsWith("account.")).sort();
  assert.deepEqual(turkishKeys, englishKeys);
  assert.equal(en["account.account"], "Account");
  assert.equal(en["account.profile"], "Profile");
  assert.equal(en["account.signIn"], "Sign in");
  assert.equal(en["account.signOut"], "Sign out");
  assert.equal(tr["account.account"], "Hesap");
  assert.equal(tr["account.profile"], "Profil");
  assert.equal(tr["account.signIn"], "Giriş yap");
  assert.equal(tr["account.signOut"], "Çıkış yap");
});

test("account session is server-owned, hint-gated and never derived from wallet persistence", async () => {
  const [server, context, profile, wallet, logout] = await Promise.all([
    source("src/lib/account/server.ts"),
    source("src/components/AccountContext.tsx"),
    source("src/components/MergenProfile.tsx"),
    source("src/components/WalletContext.tsx"),
    source("src/app/api/account/logout/route.ts")
  ]);
  assert.match(server, /__Host-mergen_base_account/);
  assert.match(server, /aes-256-gcm/);
  assert.match(server, /httpOnly, secure: true, sameSite: "lax"/);
  assert.match(server, /code_challenge_method: "S256"/);
  assert.doesNotMatch(`${server}\n${context}\n${profile}`, /localStorage|sessionStorage/);
  assert.match(context, /if \(hasAccountHint\(\)\)[\s\S]*?loadProfile\(\)/);
  assert.doesNotMatch(context, /wallet|Wallet/);
  assert.doesNotMatch(profile, /linkedWallet|walletAddress|activeWallet/);
  assert.doesNotMatch(logout, /wallet|eth_|disconnect/i);
  assert.match(logout, /logoutTransferDocument/);
  assert.doesNotMatch(logout, /redirect\([^\n]+307/);
  assert.match(wallet, /LEGACY_WALLET_SESSION_STORAGE_KEYS/);
});

test("one overlay manager owns account, wallet, market and trade focus", async () => {
  const [manager, profile, wallet, trade] = await Promise.all([
    source("src/components/OverlayManager.tsx"),
    source("src/components/MergenProfile.tsx"),
    source("src/components/WalletPicker.tsx"),
    source("src/components/base-terminal/TradeDock.tsx")
  ]);
  assert.match(manager, /PRIMARY_OVERLAYS = new Set<OverlayType>\(\["market_inspector", "market_board", "pool_drawer", "trade_drawer", "mergen_profile", "wallet_picker"\]\)/);
  assert.match(manager, /document\.addEventListener\("keydown", onKeyDown, true\)/);
  assert.match(manager, /data-overlay-root/);
  assert.doesNotMatch(`${profile}\n${wallet}\n${trade}`, /addEventListener\("keydown"/);
  assert.match(trade, /createPortal/);
});
