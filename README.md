# KeyVeil — Blind Secrets Gateway for AI Agents (prod)

<p><img src="brand/app-icon.png" alt="KeyVeil mark" width="72" height="72" /></p>

Multi-user prod vault: users sign in with Google, store third-party API keys, and let AI agents (OpenCode) **use** them via a blind proxy without ever seeing the characters.

Stack: Cloudflare Pages (UI) + Workers (API) + D1 (metadata/audit) + KV (encrypted blobs).

## Layout

```
apps/web/        # Cloudflare Pages frontend (Vite + React + TS, `dist/` deploy)
workers/api/     # Cloudflare Worker API (TypeScript, zero-deps, Web Standards)
packages/cli/    # `keyveil` terminal CLI (login, secrets, keys, proxy)
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

Blind agents call `POST /v1/proxy/:provider/:action` — Worker injects the secret server-side and returns only the result. Raw values leave the server only via `GET /v1/secrets/:name` with an explicit `secrets:reveal` scope (terminal use, audit-logged).

Terminal: `npm run cli -- login --token <tv_live_...>` then `secrets`, `keys`, `proxy` subcommands (see `packages/cli/README.md`).
