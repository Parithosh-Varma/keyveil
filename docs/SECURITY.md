# Security notes (read before prod)

1. You are now custodian of users' third-party keys. Minimize scopes at proxy (e.g. create-repo only, not delete), require per-tool consent in UI.
2. Never log `Authorization` headers, request bodies containing secrets, or decrypted values. Audit metadata only.
3. `ENCRYPTION_KEK`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` via `wrangler secret put` only. Never in git / Pages env.
4. Sessions: opaque 256-bit ids in D1 `sessions` table (30d TTL, `/v1/auth/logout` revokes). Old HMAC format no longer accepted.
5. Google `id_token`: full RS256 signature verification against Google certs (cached 1h) + `iss/aud/exp/email_verified` checks. OAuth `state` CSRF cookie (5 min).
6. IP allowlist is optional per agent key, not global. Laptop IPs change — prefer short TTL (30-90d) + scopes + revocation over strict IP pinning for real users.
7. Rate-limit `/v1/proxy/*`: in-worker 60 req/min per agent key (isolate-local) + add a Cloudflare Rate Limiting Rule for edge-wide enforcement.
8. CORS: lock `Access-Control-Allow-Origin` to your Pages domain.
9. Rotation: UI must support re-store (overwrite ciphertext) + revoke agent key instantly (`revoked_at`).
10. Incident: rotate KEK (re-wrap DEKs), revoke keys, notify users from audit log.
