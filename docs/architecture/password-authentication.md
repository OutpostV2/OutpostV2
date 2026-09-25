# Password authentication

The API uses the following routes:

| Route | Input / result |
| --- | --- |
| POST /api/v1/auth/password/register | display_name, username, email, password; safe user fields, HTTP 201 |
| POST /api/v1/auth/password/login | identifier (email or username), password; access_token, token_type, expires_in |
| POST /api/v1/auth/logout | Authorization: Bearer access-token; revoke current session, clear refresh cookie, HTTP 204 |
| GET /api/v1/me | Authorization: Bearer access-token; safe current-user fields |

User and credential writes are atomic. Email addresses are validated without DNS I/O and normalized lowercase; usernames use 3–64 ASCII letters, digits, and underscores. Database indexes enforce case-insensitive uniqueness. Existing collisions cause migration failure, never implicit account merging.

Passwords preserve all characters and spaces and allow 12–1024 characters. The Node `argon2` package uses Argon2id with the existing compatible parameters. Login failures use a generic response. A dummy verifier performs password work for unknown accounts. SQL parameter logging is disabled and validation responses omit submitted values.

## Runtime configuration

Set OUTPOST_AUTH_SIGNING_KEY to a cryptographically random secret of at least 32 bytes. Keep it in the ignored backend-js/.env locally and in the deployment secret store later. All API instances must share the same key. Changing it invalidates outstanding access tokens. Do not commit or print it. Without a key, login fails closed with HTTP 503.

Access JWTs use a fixed HS256 algorithm, issuer outpost, audience outpost-api, and a 15-minute lifetime. Required claims are validated and each request checks session ownership, expiry, revocation, and user status. Access tokens belong in browser memory.

The 30-day refresh value has 256 bits of randomness; only its SHA-256 digest is persisted. It is delivered exclusively as a host-only outpost_refresh cookie with Secure, HttpOnly, SameSite=Strict, and Path=/api/v1/auth. Use HTTPS when exercising browser cookie behavior. Login and authenticated-user responses use Cache-Control: no-store. Clients must use JSON request bodies; no cookie is accepted as an access credential.

Refresh rotation, replay detection, session listing/revocation, logout-all, email verification, and password recovery are implemented in the Node API.

Implementation: `backend-js/src/modules/auth/passwords.js` and `backend-js/src/modules/auth/tokens.js`.

Logout requires the current bearer access credential; cookie-only requests fail with 401. Revocation and its security event commit together, and existing access tokens for that session are denied immediately. Other sessions remain active. Clients should clear their in-memory access token after logout; repeated use of a revoked token receives 401.
