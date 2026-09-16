# Security notes (read before prod)

1. You are now custodian of users' third-party keys. Minimize scopes at proxy (e.g. create-repo only, not delete), require per-tool consent in UI.
2. Never log `Authorization` headers, request bodies containing secrets, or decrypted values. Audit metadata only.
3. `ENCRYPTION_KEK`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` via `wrangler secret put` only. Never in git / Pages env.
4. Sessions: this scaffold uses HMAC-signed `session=userId.sig`. Harden to opaque session rows in D1 + rotation before public launch.
5. Google `id_token` verification here is minimal (aud check). Verify signature via Google certs + `iss/exp` in prod.
6. IP allowlist is optional per agent key, not global. Laptop IPs change — prefer short TTL (30-90d) + scopes + revocation over strict IP pinning for real users.
7. Rate-limit `/v1/proxy/*` per user + per key (add Cloudflare Rate Limiting Rules).
8. CORS: lock `Access-Control-Allow-Origin` to your Pages domain.
9. Rotation: UI must support re-store (overwrite ciphertext) + revoke agent key instantly (`revoked_at`).
10. Incident: rotate KEK (re-wrap DEKs), revoke keys, notify users from audit log.
