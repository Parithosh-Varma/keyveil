# KeyVeil — Blind Secrets Gateway for AI Agents (prod)

Multi-user prod vault: users sign in with Google, store third-party API keys, and let AI agents (OpenCode) **use** them via a blind proxy without ever seeing the characters.

Stack: Cloudflare Pages (UI) + Workers (API) + D1 (metadata/audit) + KV (encrypted blobs).

## Layout

```
apps/web/        # Cloudflare Pages frontend (static, no build step required)
workers/api/     # Cloudflare Worker API (TypeScript, zero-deps, Web Standards)
db/              # D1 schema + migrations
docs/            # Architecture, security, setup
SKILL.md         # Paste-this instruction for OpenCode
openapi.yaml     # Agent-facing API contract
```

## Quickstart

1. `cp .env.example .env` and fill Google OAuth client + domains.
2. `npm install -g wrangler`
3. Create D1 + KV:
   `wrangler d1 create keyveil-db`
   `wrangler kv:namespace create VEIL_KV`
   Paste IDs into `workers/api/wrangler.toml`.
4. Apply schema: `wrangler d1 execute keyveil-db --file=db/schema.sql`
5. Dev API: `npm run dev:api` — Dev UI: `npm run dev:web`
6. Deploy: `npm run deploy:api` + `npm run deploy:web`

See `docs/SETUP.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`.

## Core rule

Agents never call `GET /v1/secrets/:name` to read raw values (bootstrap only, redacted by default).
Agents call `POST /v1/proxy/:provider/:action` — Worker injects the secret server-side and returns only the result.
