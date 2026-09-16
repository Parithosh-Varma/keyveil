#!/usr/bin/env node
// keyveil — terminal CLI for the KeyVeil blind secrets gateway.
const { Command } = require("commander");
const { version } = require("../package.json");
const { loginCommand } = require("../src/commands/login");
const { secretsCommand } = require("../src/commands/secrets");
const { keysCommand } = require("../src/commands/keys");
const { proxyCommand } = require("../src/commands/proxy");
const { auditCommand } = require("../src/commands/audit");

const program = new Command();
program.name("keyveil").description("Manage KeyVeil secrets and agent keys from your terminal").version(version);

program
  .command("login")
  .description("Store your agent token in ~/.keyveil/config.json")
  .option("-t, --token <token>", "token value (otherwise prompted)")
  .option("--api <url>", "remember a custom API base URL")
  .option("--status", "validate the stored token via /v1/whoami (never prints it)")
  .action((opts) => loginCommand(opts).catch(fail));

const secrets = program.command("secrets").description("Manage your secrets (values stay yours)");
secrets
  .command("list")
  .description("List secret names (metadata only)")
  .option("--api <url>")
  .action((opts) => secretsCommand("list", {}, opts).catch(fail));
secrets
  .command("add <name>")
  .description("Store/overwrite a secret (prompts hidden if --value omitted)")
  .option("--value <value>")
  .option("--api <url>")
  .action((name, opts) => secretsCommand("add", { name }, opts).catch(fail));
secrets
  .command("get <name>")
  .description("Print a secret value (needs secrets:reveal scope — audited)")
  .option("--api <url>")
  .action((name, opts) => secretsCommand("get", { name }, opts).catch(fail));
secrets
  .command("delete <name>")
  .description("Delete a secret")
  .option("--api <url>")
  .action((name, opts) => secretsCommand("delete", { name }, opts).catch(fail));

const keys = program.command("keys").description("Manage agent keys (needs keys:manage scope)");
keys
  .command("list")
  .description("List key metadata (never hashes)")
  .option("--api <url>")
  .action((opts) => keysCommand("list", {}, opts).catch(fail));
keys
  .command("create")
  .description("Create a key — full token printed ONCE")
  .option("--name <name>", "key label", "terminal")
  .option("--scopes <csv>", "explicit scopes (omit for proxy-only default; terminal keys need secrets:reveal,keys:manage,audit:read)", "")
  .option("--ttl <days>", "expiry in days", "90")
  .option("--single-use", "key dies after one proxy call")
  .option("--ips <csv>", "optional IP allowlist")
  .option("--api <url>")
  .action((opts) => keysCommand("create", {}, opts).catch(fail));
keys
  .command("revoke <id>")
  .description("Revoke a key by id")
  .option("--api <url>")
  .action((id, opts) => keysCommand("revoke", { id }, opts).catch(fail));

program
  .command("proxy <provider> <action>")
  .description("Blind proxy call — server injects the secret, you only see the result")
  .option("-d, --data <json>", "JSON args for the action", "{}")
  .option("--api <url>")
  .action((provider, action, opts) => proxyCommand(provider, action, opts).catch(fail));

program
  .command("audit")
  .description("Show the audit log (needs audit:read scope — values never included)")
  .option("--api <url>")
  .action((opts) => auditCommand(opts).catch(fail));

program.parse(process.argv);

function fail(err) {
  console.error(`keyveil: ${err.message}`);
  process.exit(1);
}
