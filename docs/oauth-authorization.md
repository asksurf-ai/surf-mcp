# OAuth 2.1 Authorization for Surf MCP — Interface Specification (Draft)

Status: **draft for cross-team alignment** — the authorization server described
here is to be implemented in muninn behind a feature flag. surf-mcp already
ships the resource-server half (credential passthrough + protected resource
metadata, dark until configured).

## Architecture

One account anchor, two token semantics:

```
MCP client ──► surf-mcp (mcp.asksurf.ai)          resource server entry
                 │  forwards Authorization verbatim
                 ▼
              hermod (api.asksurf.ai/gateway)      validation + billing
                 │  RS256 verify (existing public key)
                 ▼
              muninn /v2/oauth/*                   authorization server (new)
                 first-party app login (/v2/auth/*) unchanged
```

- The user account is always the muninn `user_id`. No second account store.
- First-party app JWTs (no `aud` claim) keep full access — behavior unchanged.
- OAuth access tokens are the same RS256 JWTs signed by the same muninn
  private key, plus three claims: `aud`, `client_id`, `scope`.

## Discovery

| Endpoint | Served by | Notes |
|----------|-----------|-------|
| `GET /.well-known/oauth-protected-resource` | surf-mcp | Implemented. Points at the authorization server via `SURF_OAUTH_AUTHORIZATION_SERVER`; lists `scopes_supported`. |
| `GET /.well-known/oauth-authorization-server` | muninn (relayed by surf-mcp) | RFC 8414 metadata: issuer, `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, `revocation_endpoint`, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported: ["authorization_code", "refresh_token"]`, plus the OpenID members below. |
| `GET /.well-known/openid-configuration` | muninn (relayed by surf-mcp) | OpenID Connect Discovery 1.0. Same document as above: adds `userinfo_endpoint`, `jwks_uri`, `subject_types_supported: ["public"]`, `id_token_signing_alg_values_supported: ["RS256"]`, `claims_supported`. |

## OpenID Connect layer

Hosts such as ChatGPT can only enforce workspace domain restrictions when the
authorization server is also an OpenID provider that reveals the signed-in
account's verified email. The OAuth server therefore carries a thin OIDC
layer; nothing about the data-plane access token changes.

- Scopes: `data:read` (base, always granted), `openid`, `email`. Requesting
  `openid` returns an `id_token` in the token response and enables
  `/userinfo`; `email` releases `email` + `email_verified: true` through both.
  A client that asks for `openid email` only still receives `data:read`, so
  the OpenID default request keeps working against the data API.
- `id_token`: RS256 JWT signed with the same muninn key as access tokens,
  header `kid` = RFC 7638 thumbprint. Claims `iss` (the discovery issuer),
  `sub` (muninn `user_id`), `aud` (the `client_id`), `exp`, `iat`, `nonce`
  (echoed from the authorization request via the consent page), and the email
  claims when granted. Issued on the authorization-code exchange and on
  refresh (without `nonce`).
- `GET|POST /v2/oauth/userinfo`: authenticates the OAuth access token
  itself (first-party tokens are rejected, mirroring the account-API side of
  the token-confusion defense). Requires the `openid` scope; answers
  `{sub, email?, email_verified?}` with RFC 6750 bearer errors.
- `GET /v2/oauth/jwks`: RFC 7517 key set with the RS256 public key.
- Verified email source: the account's OTP-verified email, else its Google
  email — the same rule the enterprise verified-identity snapshot uses. An
  account without one gets an ID token and userinfo without email claims.
- Consent page contract: forward the `nonce` query parameter from the
  `/authorize` redirect into `POST /v2/oauth/consent` (`nonce` field), or
  relying parties that validate the nonce will reject the ID token.

## Authorization server endpoints (muninn, new)

All under `/v2/oauth/*`, behind a feature flag, rate-limited.

### `POST /v2/oauth/register` — Dynamic Client Registration (RFC 7591)

- Anonymous, aggressively rate-limited per IP.
- Accepts `client_name`, `redirect_uris` (https or loopback only), optional
  `logo_uri`. Public clients only (`token_endpoint_auth_method: "none"`);
  PKCE is the security boundary, no client secrets.
- Returns `client_id`. Unused registrations are garbage-collected after 30 days.

### `GET /v2/oauth/authorize`

- Params: `response_type=code`, `client_id`, `redirect_uri`, `scope`,
  `state`, `code_challenge`, `code_challenge_method=S256` (mandatory).
- No valid first-party session → 302 to the web app login page with a
  `continue` back to this request. Login itself is the existing muninn flow
  (OTP / Google / Apple); the authorization server never handles credentials.
- With a session → consent page (frontend) showing client name and scopes;
  approval issues a single-use authorization code (Redis, 10 min TTL, bound
  to `client_id` + `redirect_uri` + `code_challenge` + `user_id`).

### `POST /v2/oauth/token`

- `grant_type=authorization_code`: verifies PKCE `code_verifier`, consumes the
  code (single use — reuse revokes the grant), returns:
  - `access_token`: RS256 JWT, **1 h** TTL (matches first-party), claims
    `{user_id, aud: "surf-data", client_id, scope, exp, iat, jti}`
  - `refresh_token`: opaque, hashed at rest in `oauth_grants`, **rotated on
    every use** (RFC 9700), 30-day sliding expiry
  - `token_type: "Bearer"`, `expires_in`, `scope`
- `grant_type=refresh_token`: rotation with reuse detection — presenting a
  superseded refresh token revokes the whole grant.

### `POST /v2/oauth/revoke`

RFC 7009. Accepts access or refresh token; revoking either kills the grant.

## Data model (muninn, new tables)

- `oauth_clients`: `client_id` (UUID), `client_name`, `redirect_uris`,
  `logo_uri`, `created_at`, `last_used_at`.
- `oauth_grants`: `id`, `user_id`, `client_id`, `scope`,
  `refresh_token_hash` (SHA-256, unique), `refresh_expires_at`,
  `created_at`, `revoked`. One row per user×client consent; the "connected
  apps" page lists and revokes these.
- Authorization codes live in Redis only.
- First-party `refresh_tokens` table is untouched — third-party grants never
  mix with app sessions.

## Scopes

Start coarse: `data:read` (all Surf data endpoints). Reserve `mcp` if MCP
needs distinct treatment later. No per-domain scopes in v1.

## Token confusion controls (review checklist)

Both directions must be tested before the flag opens:

1. hermod: token with `aud` present → require `aud == "surf-data"` and scope
   coverage; reject unknown `aud`.
2. muninn: any token carrying `aud`/`client_id` is rejected on account
   management APIs (`/v2/auth/*`, profile, key management). A data-scope
   token must never mutate the account.
3. surf-mcp: forwards credentials only to the configured
   `SURF_API_BASE_URL`; never logs the `Authorization` header.
4. Authorization code single-use + PKCE S256 enforced (no `plain`).
5. Refresh token reuse detection revokes the grant.

## Rollout order

1. surf-mcp passthrough + dark metadata endpoint (this repo — done).
2. muninn tables + endpoints behind flag; e2e against staging.
3. Frontend consent page + connected-apps management.
4. hermod `aud`/`scope` enforcement branch.
5. Set `SURF_OAUTH_AUTHORIZATION_SERVER` on the MCP deployment; flag on.

Interim option (independent of OAuth): the consent page can mint a tagged
`sk-surf-` API key per client ("connected apps" = tagged keys). Same account
unification, zero hermod changes; superseded once this spec ships.
