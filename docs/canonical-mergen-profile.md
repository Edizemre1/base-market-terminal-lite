# Canonical Mergen profile consumer

## Ownership

```text
Mergen Account Service / Profile Contract
                    ↓
          mergen.finance profile
                    ↓
      Base Terminal profile consumer
```

Base Terminal owns no user profile record. It may retain an encrypted, short-lived server session projection only after the canonical account service signs that projection for the exact OAuth client, redirect, nonce and subject.

## Reconciled source

The canonical application is `Edizemre1/mergen-finance`. Its active profile presentation is `site/web/src/components/profile/profile-page.tsx`; authentication uses the Supabase SSR browser/server clients and passwordless email-link callback. The active profile computes its display name from `profiles.display_name`, then `user_metadata.full_name` or `user_metadata.name`, and finally shows the email. Its avatar is generated from the first characters of the first two whitespace/dot/at/underscore/hyphen-delimited parts of that effective name or email.

The versioned OAuth/JWKS work in Mergen PR #3 supplies confidential-client authorization code + PKCE and a five-minute ES256 identity assertion. Its existing assertion intentionally includes only `iss`, `aud`, `sub`, `iat`, `exp`, `jti` and `nonce`; it does not yet include profile fields. A companion Mergen change is therefore required before Base Terminal account integration can be enabled.

## Actual field inventory

| Requested concept | Canonical source | Terminal v1 |
|---|---|---|
| User ID | Auth user id / `profiles.id` | signed `sub`, not displayed |
| Display name | `profiles.display_name`, metadata fallback | displayed when present |
| Email | auth/profile email | displayed when present |
| Member since | auth `created_at` | displayed |
| Last sign-in | auth `last_sign_in_at` | displayed when present |
| Membership | `profiles.plan` (`free` or `pro`) | Free / Mergen Pro |
| Username or handle | no canonical field | absent |
| Image avatar | no canonical field | canonical initials fallback |
| Locale profile field | no canonical field | absent; terminal locale remains UI preference |
| Role | no canonical profile role | absent |
| Linked wallet | no canonical profile field | absent |

The active EIP-1193 address remains Wallet/Trade state. Persisted provider preference, legacy wallet address keys and active wallet connection are never inputs to the account contract.

## Version 1 signed profile claim

The companion assertion adds one exact `profile` object:

```json
{
  "version": 1,
  "email": "string-or-null",
  "display_name": "string-or-null",
  "member_since": "ISO-8601 timestamp",
  "last_sign_in_at": "ISO-8601 timestamp-or-null",
  "membership": "free-or-pro"
}
```

No additional property is accepted. Base Terminal validates the exact JWT header and claim set, exact issuer and audience, callback nonce, signature against the bounded JWKS document, five-minute lifetime and the UUID subject before creating its own encrypted session.

## Session and browser boundary

The current `mergen.finance` Supabase session cookie is host-only and cannot be read by `staging.mergen.finance`. Broad parent-domain cookies are deliberately not introduced. Base Terminal uses a server-side confidential-client code exchange with PKCE; the assertion and client secret never reach browser JavaScript.

Base session and OAuth transition cookies are `__Host-`, Secure, SameSite=Lax, path `/`, HttpOnly and short-lived. A non-sensitive, short-lived hint cookie only tells the browser whether a session check is worth making. Fresh anonymous loads therefore make no account request. Profile data stays in React memory only and is cleared on expiration, logout, unavailable verification or offline transition. No account token or profile is stored in localStorage/sessionStorage.

Logout starts with a same-origin POST to Base Terminal and clears the Base cookies. Base returns a no-store, CSP-bound one-purpose form document that submits a new POST from the exact terminal origin to the configured canonical Mergen logout URL; this avoids cross-origin redirect origin taint. The companion Mergen route accepts only an exact terminal origin derived from its registered callback and only that origin's exact `/terminal?account=logged_out` return target, clears the canonical session, and redirects. GET logout, open redirects and permissive CORS are rejected.

## State contract

The consumer distinguishes: `anonymous`, `sign_in_required`, `callback_pending`, `authenticated`, `session_expired`, `profile_loading`, `profile_ready`, `profile_unavailable`, `offline` and `logged_out`.

Only `profile_ready` can render personal fields. Missing or invalid canonical data produces an unavailable/expired state; it never produces a placeholder person, fabricated membership or wallet-derived avatar.

## Activation boundary

`MERGEN_ACCOUNT_OAUTH_ENABLED` is false unless explicitly set to `true`. Enabling requires exact HTTPS issuer/endpoint/origin configuration, a UUID client id, confidential client secret and a canonical 32-byte Base session secret. Until the companion Mergen profile assertion and logout contract is deployed and the environment registration is verified, staging keeps the account consumer disabled and exposes only the truthful anonymous/sign-in-required/unavailable states.
