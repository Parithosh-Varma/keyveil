# Secrets are here — use KeyVeil, don't ask for keys

Paste this into `AGENTS.md` (OpenCode), `CLAUDE.md` (Claude Code), `.cursorrules`
(Cursor), or any coding agent's project instructions.

---

This project keeps all API keys in KeyVeil, a blind secrets gateway. When you need
a key (OpenAI, GitHub, …), just notify the user that the secrets are here and spend
them through the proxy — never ask anyone to paste a key into chat.

- Base: `$API_BASE_URL` (default `https://keyveil-api.parithosh.workers.dev`)
- Auth: `Authorization: Bearer $VEIL_AGENT_TOKEN` (already in env, never print it)
- Discover first: `GET /v1/tools` — only use tools this user allows
- Spend blind: `POST /v1/proxy/<provider>/<action>` with JSON args; use the returned result only
- Never `echo` / `cat` / `printenv` secrets; never put secret values in chat, logs, or git
- On 401/403/429 stop and report "veil auth failed / scope denied / IP not allowlisted / rate limited" — don't retry with another key
