# Security notes (read before prod)

1. You are now custodian of users' third-party keys. Minimize scopes at proxy (e.g. create-repo only, not delete), require per-tool consent in UI.
2. Never log `Authorization` headers, request bodies containing secrets, or decrypted values. Audit metadata only.
3. `ENCRYPTION_KEK`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` via `wrangler secret put` only. Never in git / Pages env.
4. Sessions: opaque 256-bit ids in D1 `sessions` table (7d TTL, `/v1/auth/logout` revokes). Old HMAC format no longer accepted. Bearer session lives in dashboard localStorage — XSS owns it, so CSP stays strict and revealed secrets / one-time tokens auto-hide in the UI.
5. Google `id_token`: full RS256 signature verification against Google certs (cached 1h) + `iss/aud/exp/email_verified` checks. OAuth `state` CSRF cookie (5 min).
6. IP allowlist is optional per agent key, not global. Rules accept exact IPv4 or `A.B.C.0/24` only (validated at mint, fail-closed). Client IP comes from `CF-Connecting-IP` alone — `X-Forwarded-For` is untrusted. Laptop IPs change — prefer short TTL (30-90d) + scopes + revocation over strict IP pinning for real users.
7. Rate-limit auth + writes + proxy: in-worker per-IP sliding window on `/v1/auth/*`, `/v1/secrets` POST, `/v1/agent-keys` POST, plus 60 req/min per agent key on `/v1/proxy/*` (all isolate-local) + add a Cloudflare Rate Limiting Rule for edge-wide enforcement. Cookie-authed POST/DELETE also require a same-site Origin/Referer (CSRF).
8. CORS: lock `Access-Control-Allow-Origin` to your Pages domain.
9. Rotation: UI must support re-store (overwrite ciphertext) + revoke agent key instantly (`revoked_at`).
10. Incident: rotate KEK (re-wrap DEKs), revoke keys, notify users from audit log.
