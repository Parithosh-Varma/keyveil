const { api, context, printTable } = require("../lib/api");

async function auditCommand(opts) {
  const ctx = context(opts);
  const { audit } = await api("/v1/audit", { ctx });
  printTable(
    (audit || []).map((r) => ({ ...r, ok: r.ok ? "ok" : "denied" })),
    ["created_at", "actor", "provider", "action", "ok", "ip"]
  );
}

module.exports = { auditCommand };
