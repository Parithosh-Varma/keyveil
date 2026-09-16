# Setup

1. Prereqs: `npm i -g wrangler`, a Cloudflare account, Google Cloud OAuth client (Web, authorized redirect = `https://api.yourdomain.com/v1/auth/google/callback`).
2. `cp .env.example .env` (local only).
3. Bindings:
   ```
   wrangler d1 create keyveil-db
   wrangler kv:namespace create VEIL_KV
   ```
   Paste IDs into `workers/api/wrangler.toml` (uncomment `[[d1_databases]]` / `[[kv_namespaces]]`).
4. Schema: `wrangler d1 execute keyveil-db --file=db/schema.sql --remote`
5. Secrets:
   ```
   wrangler secret put GOOGLE_CLIENT_ID --cwd workers/api
   wrangler secret put GOOGLE_CLIENT_SECRET --cwd workers/api
   wrangler secret put SESSION_SECRET --cwd workers/api
   wrangler secret put ENCRYPTION_KEK --cwd workers/api  # 32 random bytes, base64
   ```
6. Dev:
   ```
   npm run dev:api   # http://127.0.0.1:8787
    npm run dev:web   # Vite React+TS at :5173 (allowed CORS origin), type `api http://127.0.0.1:8787` in-terminal
   ```
7. Deploy:
   ```
   npm run deploy:api
   npm run deploy:web
   ```
   Point `api.yourdomain.com` to Worker, `yourdomain.com` to Pages. Set `WEB_BASE_URL` + `GOOGLE_REDIRECT_URL`.

Add a new blind tool: add entry to `TOOLS` in `workers/api/src/types.ts`, implement route in `src/routes/proxy.ts`, wire scope in `src/index.ts`, document in `openapi.yaml`.
