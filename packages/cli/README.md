# keyveil CLI — manage your secrets and agent keys from the terminal

Part of the [KeyVeil](https://github.com/Parithosh-Varma/keyveil) monorepo (`packages/cli`). For you and your agents: see your own secret values, rotate keys, and run blind proxy calls — all from the terminal.

## Install

```bash
# from the repo root
npm install

# run via workspace
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
keyveil keys create --name opencode --scopes 'github:create-repo,openai:chat' --ttl 90 [--ips '1.2.3.4']
keyveil keys revoke <id>
```

Scopes: any `provider:action` proxy scope, plus `secrets:reveal`, `keys:manage`, `audit:read`, or `*`. Only grant `secrets:reveal` to keys that live in your own terminal — never to a shared agent.

## Blind proxy (agents use keys without seeing them)

```bash
keyveil proxy github create-repo -d '{"name":"my-project","isPublic":true}'
keyveil proxy openai chat -d '{"model":"gpt-4o-mini","input":"hello"}'
keyveil proxy --help
```

## Test

```bash
npm test --workspace packages/cli
```
