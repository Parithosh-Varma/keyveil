const { api, context, prompt, printTable } = require("../lib/api");

function cleanName(name) {
  const clean = String(name || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 64);
  if (!clean) throw new Error(`invalid secret name: ${name}`);
  return clean;
}

async function secretsCommand(sub, args, opts) {
  const ctx = context(opts);
  if (sub === "list") {
    const { secrets } = await api("/v1/secrets", { ctx });
    printTable(
      (secrets || []).map((s) => ({ ...s, preview: s.preview || "—", last_used: s.last_used || "—" })),
      ["name", "preview", "updated_at", "last_used"]
    );
  } else if (sub === "add") {
    const name = cleanName(args.name);
    const value = (opts.value !== undefined ? opts.value : await prompt(`Value for ${name} (hidden): `, { hidden: true })).trim();
    if (value.length < 3) throw new Error("value too short, nothing stored");
    const res = await api("/v1/secrets", { ctx, method: "POST", body: { name, value } });
    console.log(`stored ${res.name} (encrypted server-side)`);
  } else if (sub === "get") {
    const name = cleanName(args.name);
    const res = await api(`/v1/secrets/${name}`, { ctx });
    process.stdout.write(res.value + "\n");
  } else if (sub === "delete") {
    const name = cleanName(args.name);
    await api(`/v1/secrets/${name}`, { ctx, method: "DELETE" });
    console.log(`deleted ${name}`);
  }
}

module.exports = { secretsCommand };
