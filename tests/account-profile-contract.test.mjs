import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MERGEN_ACCOUNT_STATES,
  readCanonicalProfileClaim,
  profileInitials
} from "../src/lib/account/contract.ts";
import { en, tr } from "../src/i18n/dictionaries.ts";

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

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
  const claim = {
    version: 1,
    email: "member@example.com",
    display_name: "Mergen Member",
    member_since: "2025-01-02T03:04:05.000Z",
    last_sign_in_at: "2026-08-30T10:00:00.000Z",
    membership: "pro"
  };
  assert.deepEqual(readCanonicalProfileClaim("123e4567-e89b-42d3-a456-426614174000", claim), {
    version: 1,
    subject: "123e4567-e89b-42d3-a456-426614174000",
    email: "member@example.com",
    displayName: "Mergen Member",
    memberSince: "2025-01-02T03:04:05.000Z",
    lastSignInAt: "2026-08-30T10:00:00.000Z",
    membership: "pro"
  });
  assert.equal(readCanonicalProfileClaim("wallet-address", claim), undefined);
  assert.equal(readCanonicalProfileClaim("123E4567-E89B-42D3-A456-426614174000", claim), undefined);
  assert.equal(readCanonicalProfileClaim("123e4567-e89b-42d3-a456-426614174000", { ...claim, display_name: " Mergen Member " }), undefined);
  assert.equal(readCanonicalProfileClaim("123e4567-e89b-42d3-a456-426614174000", { ...claim, member_since: "2025-01-02" }), undefined);
  assert.equal(readCanonicalProfileClaim("123e4567-e89b-42d3-a456-426614174000", { ...claim, handle: "invented" }), undefined);
  assert.equal(readCanonicalProfileClaim("123e4567-e89b-42d3-a456-426614174000", { ...claim, membership: "admin" }), undefined);
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
