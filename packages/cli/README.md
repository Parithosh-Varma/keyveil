# keyveil CLI — manage your secrets and agent keys from the terminal

Part of the [KeyVeil](https://github.com/Parithosh-Varma/keyveil) monorepo (`packages/cli`). For you and your agents: see your own secret values, rotate keys, and run blind proxy calls — all from the terminal.

## Install

```bash
npm i -g keyveil
```

From source instead (repo root):

```bash
npm install
npm run cli -- <command>
# or link globally once
npm link --workspace packages/cli
keyveil --help
```

Requires Node >= 18. No other dependencies besides `commander`.

## Auth

```bash
keyveil login --token tv_live_...       # from dashboard → create agent key; stored mode 600 in ~/.keyveil/config.json
keyveil login --status                  # validate token (never prints it)
keyveil login --api http://127.0.0.1:8787   # point at a local/dev API (default: production)
```

Env overrides: `VEIL_AGENT_TOKEN`, `VEIL_API_URL`. Isolated home for tests: `KEYVEIL_HOME`.

## Secrets (yours — terminal may show values)

```bash
keyveil secrets list
keyveil secrets add GITHUB_TOKEN            # prompts hidden; or --value <v>
keyveil secrets get GITHUB_TOKEN            # needs secrets:reveal scope — every reveal is audit-logged
keyveil secrets delete OLD_TOKEN
```

## Agent keys (needs `keys:manage` scope)

```bash
keyveil keys list
keyveil keys create --name opencode --ttl 90 [--ips '1.2.3.4']   # proxy-only scopes, locked at creation
keyveil keys create --name terminal --scopes 'secrets:reveal,keys:manage,audit:read' --ttl 90
keyveil keys revoke <id>
```

Scopes lock at creation and can't be widened later. Omit `--scopes` for the proxy-only default
(`openai:chat`, `github:create-repo`); agent-created keys inherit the creator's scopes. Only grant
`secrets:reveal` to keys that live in your own terminal — never to a shared agent.

## Blind proxy (agents use keys without seeing them)

```bash
keyveil proxy github create-repo -d '{"name":"my-project","isPublic":true}'
keyveil proxy openai chat -d '{"model":"gpt-4o-mini","input":"hello"}'
keyveil proxy --help
```

## Audit (needs `audit:read` scope)

```bash
keyveil audit     # timestamp, actor, provider, action, result — values never included
```

## Test

```bash
npm test --workspace packages/cli
```
