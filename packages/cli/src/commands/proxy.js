const { api, context } = require("../lib/api");

async function proxyCommand(provider, action, opts) {
  const ctx = context(opts);
  let data;
  try {
    data = JSON.parse(opts.data || "{}");
  } catch {
    throw new Error("--data must be valid JSON");
  }
  const res = await api(`/v1/proxy/${provider}/${action}`, { ctx, method: "POST", body: data });
  console.log(JSON.stringify(res, null, 2));
}

module.exports = { proxyCommand };
