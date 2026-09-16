const { api, context, printTable } = require("../lib/api");

async function keysCommand(sub, _args, opts) {
  const ctx = context(opts);
  if (sub === "list") {
    const { keys } = await api("/v1/agent-keys", { ctx });
    printTable(keys || [], ["id", "name", "key_prefix", "scopes", "expires_at", "revoked_at"]);
  } else if (sub === "create") {
    const scopes = String(opts.scopes || "").split(",").map((s) => s.trim()).filter(Boolean);
    const body = {
      name: opts.name,
      ttl_days: Number(opts.ttl),
      ip_allowlist: opts.ips ? String(opts.ips).split(",").map((s) => s.trim()).filter(Boolean) : [],
    };
    if (scopes.length) body.scopes = scopes; // omit → server assigns (proxy-only for humans, inherit for agents)
    const res = await api("/v1/agent-keys", { ctx, method: "POST", body });
    console.log(`created key ${res.id} (${res.prefix}) scopes=${(res.scopes || []).join(",")}`);
    console.log("SAVE THIS TOKEN NOW — it is shown only once:");
    console.log(res.token);
  } else if (sub === "revoke") {
    await api(`/v1/agent-keys/${_args.id}/revoke`, { ctx, method: "POST" });
    console.log(`revoked ${_args.id}`);
  }
}

module.exports = { keysCommand };

