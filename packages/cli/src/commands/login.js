const { api, context } = require("../lib/api");
const { configFile, resolveApiUrl, saveAuth } = require("../lib/config");
const { prompt } = require("../lib/api");

async function loginCommand({ token, api: apiFlag, status } = {}) {
  if (status) {
    const ctx = context({ api: apiFlag });
    const me = await api("/v1/whoami", { ctx });
    console.log(`ok as ${me.user_id} via ${me.via}${me.key_name ? ` (key: ${me.key_name})` : ""}`);
    console.log(`scopes: ${(me.scopes || []).join(", ") || "(none)"}`);
    console.log(`api: ${ctx.apiUrl}`);
    return;
  }
  const value = (token || (await prompt("Agent token (tv_live_...): "))).trim();
  if (!value) throw new Error("empty token, nothing stored");
  const file = saveAuth({ token: value, apiUrl: apiFlag });
  console.log(`saved to ${file} (api: ${resolveApiUrl(apiFlag)})`);
}

module.exports = { loginCommand };
