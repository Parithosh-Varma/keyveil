# veil-use skill — paste this into OpenCode every time

You have access to a personal blind secrets gateway. Do NOT ask the user for API keys.

```
Base: $API_BASE_URL (e.g. https://api.yourdomain.com)
Auth: Authorization: Bearer $VEIL_AGENT_TOKEN (already in env, never print it)
```

Rules:
1. Prefer blind proxy. `POST /v1/proxy/<provider>/<action>` with JSON args. Use the returned result only.
   - GitHub repo: `POST /v1/proxy/github/create-repo {"name":"foo","isPublic":true}`
   - OpenAI: `POST /v1/proxy/openai/chat {"model":"gpt-4o-mini","input":"..."}`
2. Discover first: `GET /v1/tools` lists what this user allows.
3. Never `echo` / `cat` / `printenv` secrets. Never put secret values in chat, logs, or git. If you used `GET /v1/secrets` (bootstrap only), write straight to gitignored `.env` and redact output.
4. On 401/403/429 stop and say: "veil auth failed / scope denied / IP not allowlisted / rate limited" — do not retry with a different key, do not dump headers.
5. Every proxy call is audit-logged per user. Keep args minimal.

Example (curl, token hidden):
```bash
curl -s -H "Authorization: Bearer $VEIL_AGENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"my-project","isPublic":true}' \
  "$API_BASE_URL/v1/proxy/github/create-repo"
```
