// Tests for keyveil CLI helpers. Run: npm test --workspace packages/cli
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function isolatedHome() {
  process.env.KEYVEIL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "keyveil-home-"));
  delete process.env.VEIL_AGENT_TOKEN;
  delete process.env.VEIL_API_URL;
  delete require.cache[require.resolve("../src/lib/config")];
  return require("../src/lib/config");
}

test("saveAuth/loadToken round-trips; resolveApiUrl prefers flag > env > saved > default", () => {
  const cfg = isolatedHome();
  cfg.saveAuth({ token: "tok-1", apiUrl: "https://saved.invalid" });
  assert.equal(cfg.loadToken(), "tok-1");
  assert.equal(cfg.resolveApiUrl("https://flag.invalid"), "https://flag.invalid");
  process.env.VEIL_API_URL = "https://env.invalid";
  assert.equal(cfg.resolveApiUrl(), "https://env.invalid");
  delete process.env.VEIL_API_URL;
  assert.equal(cfg.resolveApiUrl(), "https://saved.invalid");
  assert.equal(cfg.resolveApiUrl.call(null), "https://saved.invalid");
});

test("resolveApiUrl falls back to DEFAULT_API when nothing stored", () => {
  const cfg = isolatedHome();
  assert.equal(cfg.resolveApiUrl(), cfg.DEFAULT_API);
});

test("loadToken falls back to VEIL_AGENT_TOKEN env", () => {
  isolatedHome();
  process.env.VEIL_AGENT_TOKEN = "env-token";
  delete require.cache[require.resolve("../src/lib/config")];
  assert.equal(require("../src/lib/config").loadToken(), "env-token");
  delete process.env.VEIL_AGENT_TOKEN;
});
