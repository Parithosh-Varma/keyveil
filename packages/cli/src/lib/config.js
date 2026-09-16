// KeyVeil home config: ~/.keyveil/config.json { token, apiUrl }. No side effects on import.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_API = "https://keyveil-api.parithosh.workers.dev";

function homeDir() {
  return process.env.KEYVEIL_HOME || path.join(os.homedir(), ".keyveil");
}

function configFile() {
  return path.join(homeDir(), "config.json");
}

function loadFile() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

function loadToken() {
  return loadFile().token || process.env.VEIL_AGENT_TOKEN || null;
}

function resolveApiUrl(cliFlag) {
  return (
    cliFlag ||
    process.env.VEIL_API_URL ||
    loadFile().apiUrl ||
    DEFAULT_API
  ).replace(/\/$/, "");
}

function saveAuth({ token, apiUrl }) {
  const dir = homeDir();
  fs.mkdirSync(dir, { recursive: true });
  const prev = loadFile();
  const next = {
    token: token !== undefined ? token : prev.token,
    apiUrl: apiUrl !== undefined ? apiUrl : prev.apiUrl,
  };
  fs.writeFileSync(configFile(), JSON.stringify(next, null, 2) + "\n", { mode: 0o600 });
  return configFile();
}

module.exports = { DEFAULT_API, configFile, loadToken, resolveApiUrl, saveAuth };
