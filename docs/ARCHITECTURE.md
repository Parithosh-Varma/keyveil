# Architecture (prod, multi-user)

```
Browser -> Pages (apps/web) -> Workers API (workers/api)
Google OAuth -> session cookie (human)     Agent -> Bearer tv_live_... + scopes + IP allowlist
Workers -> D1 (users, secrets metadata, agent_keys hash, audit) + KV (ciphertext) + Secrets Store (KEK)
Proxy: POST /v1/proxy/:provider/:action -> load + AES-GCM decrypt user secret in-memory -> upstream fetch -> return allowlisted fields only
```

Why:
- Pages can't hold secrets. All secret use happens in Workers.
- Per-user DEK wrapped by KEK (`ENCRYPTION_KEK` via `wrangler secret put`). KV/D1 only see ciphertext.
- Agent keys: `prefix.secret`, only `sha256(secret)` stored. Scopes like `github:create-repo`, optional `ip_allowlist`, `expires_at`.
- Blindness: raw `GET /v1/secrets/:name` is disabled for agents in this scaffold (metadata list is human-only). Agents get results, not keys.
- Audit every store/proxy/key event (who, provider, action, ok, ip) — no values.
