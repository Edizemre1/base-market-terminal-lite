import {
  createCipheriv,
  createHash,
  createDecipheriv,
  createPublicKey,
  randomBytes,
  verify as verifySignature
} from "node:crypto";
import type { JsonWebKey as NodeJsonWebKey } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { readCanonicalProfileClaim, type CanonicalMergenProfile } from "@/lib/account/contract";

export const ACCOUNT_SESSION_COOKIE = "__Host-mergen_base_account";
export const ACCOUNT_TRANSITION_COOKIE = "__Host-mergen_base_oauth";
export const ACCOUNT_HINT_COOKIE = "mergen_base_account_hint";
const ASSERTION_TYPE = "urn:mergen:params:oauth:token-type:account-identity+jwt";
const ASSERTION_TYP = "mergen-account-identity+jwt";
const ASSERTION_TTL_SECONDS = 300;
const TRANSITION_TTL_SECONDS = 120;
const KID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const JWK_COORDINATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type AccountIntegrationConfig = Readonly<{
  issuer: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  logoutUrl: string;
  webOrigin: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  sessionKey: Buffer;
}>;

type LoginTransition = Readonly<{
  version: 1;
  state: string;
  nonce: string;
  verifier: string;
  locale: "tr" | "en";
  expiresAt: number;
}>;

type StoredSession = Readonly<{
  version: 1;
  expiresAt: number;
  profile: CanonicalMergenProfile;
}>;

export function readAccountIntegrationConfig(): AccountIntegrationConfig | undefined {
  if (process.env.MERGEN_ACCOUNT_OAUTH_ENABLED !== "true") return undefined;
  const issuer = exactHttpsOrigin(process.env.MERGEN_ACCOUNT_ISSUER, "MERGEN_ACCOUNT_ISSUER");
  const authorizeUrl = exactHttpsUrl(process.env.MERGEN_ACCOUNT_AUTHORIZE_URL, "MERGEN_ACCOUNT_AUTHORIZE_URL");
  const tokenUrl = exactHttpsUrl(process.env.MERGEN_ACCOUNT_TOKEN_URL, "MERGEN_ACCOUNT_TOKEN_URL");
  const jwksUrl = exactHttpsUrl(process.env.MERGEN_ACCOUNT_JWKS_URL, "MERGEN_ACCOUNT_JWKS_URL");
  const logoutUrl = exactHttpsUrl(process.env.MERGEN_ACCOUNT_LOGOUT_URL, "MERGEN_ACCOUNT_LOGOUT_URL");
  const webOrigin = exactHttpsOrigin(process.env.MERGEN_ACCOUNT_WEB_ORIGIN, "MERGEN_ACCOUNT_WEB_ORIGIN");
  const redirectUri = exactHttpsUrl(process.env.MERGEN_ACCOUNT_REDIRECT_URI, "MERGEN_ACCOUNT_REDIRECT_URI");
  if ([authorizeUrl, tokenUrl, jwksUrl, logoutUrl].some((value) => new URL(value).origin !== issuer)) {
    throw new Error("Mergen account endpoints must share the exact configured issuer origin");
  }
  assertEndpoint(authorizeUrl, "/oauth/authorize", "MERGEN_ACCOUNT_AUTHORIZE_URL");
  assertEndpoint(tokenUrl, "/oauth/token", "MERGEN_ACCOUNT_TOKEN_URL");
  assertEndpoint(jwksUrl, "/.well-known/jwks.json", "MERGEN_ACCOUNT_JWKS_URL");
  assertEndpoint(logoutUrl, "/auth/signout", "MERGEN_ACCOUNT_LOGOUT_URL");
  assertEndpoint(redirectUri, "/api/account/callback", "MERGEN_ACCOUNT_REDIRECT_URI");
  const clientId = process.env.MERGEN_ACCOUNT_CLIENT_ID?.trim();
  const clientSecret = process.env.MERGEN_ACCOUNT_CLIENT_SECRET;
  if (!clientId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)) throw new Error("MERGEN_ACCOUNT_CLIENT_ID is invalid");
  if (!canonicalSecret(clientSecret)) throw new Error("MERGEN_ACCOUNT_CLIENT_SECRET is invalid");
  const sessionSecret = process.env.MERGEN_ACCOUNT_SESSION_SECRET;
  if (!sessionSecret || !/^[A-Za-z0-9_-]{43}$/.test(sessionSecret)) throw new Error("MERGEN_ACCOUNT_SESSION_SECRET is invalid");
  const sessionKey = Buffer.from(sessionSecret, "base64url");
  if (sessionKey.length !== 32 || sessionKey.toString("base64url") !== sessionSecret) throw new Error("MERGEN_ACCOUNT_SESSION_SECRET is invalid");
  return Object.freeze({ issuer, authorizeUrl, tokenUrl, jwksUrl, logoutUrl, webOrigin, clientId: clientId.toLowerCase(), clientSecret, redirectUri, sessionKey });
}

export function createLoginTransition(config: AccountIntegrationConfig, locale: "tr" | "en") {
  const verifier = randomBytes(32).toString("base64url");
  const transition: LoginTransition = Object.freeze({
    version: 1,
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    verifier,
    locale,
    expiresAt: Math.floor(Date.now() / 1_000) + TRANSITION_TTL_SECONDS
  });
  const codeChallenge = hashBase64Url(verifier);
  const target = new URL(config.authorizeUrl);
  target.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "email openid profile",
    state: transition.state,
    nonce: transition.nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  }).toString();
  return { transition, target, cookie: encryptPayload(config.sessionKey, "transition", transition) };
}

export function readLoginTransition(config: AccountIntegrationConfig, value: string | undefined): LoginTransition | undefined {
  const decoded = decryptPayload(config.sessionKey, "transition", value);
  if (!isRecord(decoded) || decoded.version !== 1 || decoded.locale !== "tr" && decoded.locale !== "en") return undefined;
  if (!canonicalSecret(decoded.state) || !canonicalSecret(decoded.nonce) || !canonicalVerifier(decoded.verifier)) return undefined;
  if (typeof decoded.expiresAt !== "number" || !Number.isSafeInteger(decoded.expiresAt) || decoded.expiresAt < Math.floor(Date.now() / 1_000)) return undefined;
  return decoded as unknown as LoginTransition;
}

export async function exchangeAuthorizationCode(config: AccountIntegrationConfig, code: string, transition: LoginTransition): Promise<StoredSession> {
  if (!canonicalSecret(code)) throw new Error("Invalid authorization code");
  const response = await fetch(config.tokenUrl, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: transition.verifier
    }).toString()
  });
  const raw = await response.text();
  if (!response.ok || raw.length > 16_384) throw new Error("Mergen token exchange failed");
  const body = parseJsonRecord(raw);
  if (!hasExactKeys(body, ["assertion_type", "identity_assertion", "expires_in"]) || body.assertion_type !== ASSERTION_TYPE || body.expires_in !== ASSERTION_TTL_SECONDS || typeof body.identity_assertion !== "string") {
    throw new Error("Mergen token response is invalid");
  }
  const assertion = await verifyIdentityAssertion(config, body.identity_assertion, transition.nonce);
  return Object.freeze({ version: 1, expiresAt: assertion.expiresAt, profile: assertion.profile });
}

export function storeAccountSession(response: NextResponse, config: AccountIntegrationConfig, session: StoredSession): void {
  const maxAge = Math.max(1, Math.min(ASSERTION_TTL_SECONDS, session.expiresAt - Math.floor(Date.now() / 1_000)));
  response.cookies.set(ACCOUNT_SESSION_COOKIE, encryptPayload(config.sessionKey, "session", session), secureCookie(maxAge, true));
  response.cookies.set(ACCOUNT_HINT_COOKIE, "1", secureCookie(maxAge, false));
}

export function readAccountSession(config: AccountIntegrationConfig, value: string | undefined): StoredSession | undefined {
  const decoded = decryptPayload(config.sessionKey, "session", value);
  if (!isRecord(decoded) || decoded.version !== 1 || typeof decoded.expiresAt !== "number" || !Number.isSafeInteger(decoded.expiresAt) || decoded.expiresAt <= Math.floor(Date.now() / 1_000)) return undefined;
  const profile = isRecord(decoded.profile)
    ? readCanonicalProfileClaim(decoded.profile.subject, {
        version: decoded.profile.version,
        email: decoded.profile.email,
        display_name: decoded.profile.displayName,
        member_since: decoded.profile.memberSince,
        last_sign_in_at: decoded.profile.lastSignInAt,
        membership: decoded.profile.membership
      })
    : undefined;
  return profile ? Object.freeze({ version: 1, expiresAt: decoded.expiresAt, profile }) : undefined;
}

export function setTransitionCookie(response: NextResponse, value: string): void {
  response.cookies.set(ACCOUNT_TRANSITION_COOKIE, value, secureCookie(TRANSITION_TTL_SECONDS, true));
}

export function clearAccountCookies(response: NextResponse): void {
  response.cookies.set(ACCOUNT_SESSION_COOKIE, "", secureCookie(0, true));
  response.cookies.set(ACCOUNT_TRANSITION_COOKIE, "", secureCookie(0, true));
  response.cookies.set(ACCOUNT_HINT_COOKIE, "", secureCookie(0, false));
}

export function canonicalProfileUrl(config: AccountIntegrationConfig, locale: "tr" | "en"): string {
  return `${config.webOrigin}/${locale}/profil`;
}

export function canonicalLogoutUrl(config: AccountIntegrationConfig): string {
  const target = new URL(config.logoutUrl);
  const clientOrigin = new URL(config.redirectUri).origin;
  target.searchParams.set("return_to", `${clientOrigin}/terminal?account=logged_out`);
  return target.toString();
}

export function logoutTransferDocument(target: string, locale: "tr" | "en", nonce: string): string {
  const action = escapeHtml(target);
  const title = locale === "tr" ? "Mergen oturumu kapatılıyor" : "Signing out of Mergen";
  const button = locale === "tr" ? "Çıkışa devam et" : "Continue sign out";
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title></head><body><form id="logout-transfer" method="post" action="${action}"><button type="submit">${button}</button></form><script nonce="${nonce}">document.getElementById("logout-transfer").submit()</script></body></html>`;
}

export function isSameOriginFormPost(request: NextRequest): boolean {
  if (request.method !== "POST") return false;
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  return origin === request.nextUrl.origin && (!fetchSite || fetchSite === "same-origin");
}

function secureCookie(maxAge: number, httpOnly: boolean) {
  return { httpOnly, secure: true, sameSite: "lax" as const, path: "/", maxAge };
}

async function verifyIdentityAssertion(config: AccountIntegrationConfig, token: string, nonce: string): Promise<{ expiresAt: number; profile: CanonicalMergenProfile }> {
  if (token.length > 12_000) throw new Error("Identity assertion is too large");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Identity assertion is malformed");
  const header = parseBase64UrlRecord(parts[0]);
  const payload = parseBase64UrlRecord(parts[1]);
  if (!hasExactKeys(header, ["alg", "kid", "typ"]) || header.alg !== "ES256" || header.typ !== ASSERTION_TYP || typeof header.kid !== "string" || !KID_PATTERN.test(header.kid)) throw new Error("Identity assertion header is invalid");
  if (!hasExactKeys(payload, ["aud", "exp", "iat", "iss", "jti", "nonce", "profile", "sub"])) throw new Error("Identity assertion claims are invalid");
  const now = Math.floor(Date.now() / 1_000);
  if (payload.iss !== config.issuer || payload.aud !== config.clientId || payload.nonce !== nonce || typeof payload.sub !== "string" || typeof payload.jti !== "string" || canonicalBase64UrlBytes(payload.jti) < 16 || payload.jti.length > 128 || !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || (payload.iat as number) > now + 30 || (payload.exp as number) <= now - 30 || (payload.exp as number) <= (payload.iat as number) || (payload.exp as number) - (payload.iat as number) > ASSERTION_TTL_SECONDS) throw new Error("Identity assertion binding is invalid");
  const profile = readCanonicalProfileClaim(payload.sub, payload.profile);
  if (!profile) throw new Error("Canonical profile claim is invalid");
  const jwksResponse = await fetch(config.jwksUrl, { cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { Accept: "application/json" } });
  const rawJwks = await jwksResponse.text();
  if (!jwksResponse.ok || rawJwks.length > 65_536) throw new Error("Mergen JWKS is unavailable");
  const document = parseJsonRecord(rawJwks);
  if (!hasExactKeys(document, ["keys"]) || !Array.isArray(document.keys) || document.keys.length < 1 || document.keys.length > 5) throw new Error("Mergen JWKS is invalid");
  const matchingKeys = document.keys.filter((candidate) => isRecord(candidate) && candidate.kid === header.kid);
  if (matchingKeys.length !== 1) throw new Error("Identity assertion key is untrusted");
  const key = matchingKeys[0];
  if (!isPublicSigningJwk(key)) throw new Error("Identity assertion key is untrusted");
  const signature = Buffer.from(parts[2], "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== parts[2] || !verifySignature("sha256", Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"), { key: createPublicKey({ key, format: "jwk" }), dsaEncoding: "ieee-p1363" }, signature)) throw new Error("Identity assertion signature is invalid");
  return { expiresAt: payload.exp as number, profile };
}

function exactHttpsOrigin(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value) throw new Error(`${name} must be an exact HTTPS origin`);
  return value;
}

function exactHttpsUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || parsed.toString() !== value) throw new Error(`${name} must be a canonical HTTPS URL`);
  return value;
}

function assertEndpoint(value: string, expectedPath: string, name: string): void {
  const parsed = new URL(value);
  if (parsed.pathname !== expectedPath || parsed.search) throw new Error(`${name} has an invalid path`);
}

function hashBase64Url(value: string): string {
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

function encryptPayload(key: Buffer, purpose: string, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`mergen-base-terminal:${purpose}:v1`, "ascii"));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${encrypted.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

function decryptPayload(key: Buffer, purpose: string, value: string | undefined): unknown {
  if (!value || value.length > 8_192) return undefined;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return undefined;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const encrypted = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    if (iv.length !== 12 || tag.length !== 16) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(`mergen-base-terminal:${purpose}:v1`, "ascii"));
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8"));
  } catch {
    return undefined;
  }
}

function canonicalSecret(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}

function canonicalCoordinate(value: unknown): value is string {
  if (typeof value !== "string" || !JWK_COORDINATE_PATTERN.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function canonicalVerifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function canonicalBase64UrlBytes(value: string): number {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return 0;
  const bytes = Buffer.from(value, "base64url");
  return bytes.toString("base64url") === value ? bytes.length : 0;
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error("Expected an object");
  return parsed;
}

function parseBase64UrlRecord(value: string): Record<string, unknown> {
  if (canonicalBase64UrlBytes(value) < 2) throw new Error("Expected canonical base64url JSON");
  return parseJsonRecord(Buffer.from(value, "base64url").toString("utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isPublicSigningJwk(value: unknown): value is NodeJsonWebKey & { kid: string } {
  if (!isRecord(value) || !hasExactKeys(value, ["alg", "crv", "kid", "kty", "use", "x", "y"])) return false;
  return value.kty === "EC" && value.crv === "P-256" && value.alg === "ES256" && value.use === "sig" && typeof value.kid === "string" && KID_PATTERN.test(value.kid) && canonicalCoordinate(value.x) && canonicalCoordinate(value.y);
}
