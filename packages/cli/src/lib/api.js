// Authed API helper + prompts. Throws with server-provided detail on !ok.
const readline = require("readline");
const { loadToken, resolveApiUrl } = require("./config");

function context(cliOpts = {}) {
  const token = loadToken();
  if (!token) throw new Error('no token stored (run "keyveil login --token <token>")');
  return { apiUrl: resolveApiUrl(cliOpts.api), token };
}

async function api(path, { ctx, method = "GET", body } = {}) {
  const res = await fetch(`${ctx.apiUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  if (!res.ok) {
    const detail = data.error || data.raw || res.statusText;
    const extra = data.need ? ` (need scope: ${data.need})` : "";
    throw new Error(`${res.status}: ${detail}${extra}`);
  }
  return data;
}

function prompt(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  if (hidden && process.stdin.isTTY) {
    // Mute echo for secret values.
    rl.output.write(question);
    const onData = (c) => {
      if (c.toString() === "\n" || c.toString() === "\r") return;
      readline.moveCursor(process.stdout, -1, 0);
      readline.clearLine(process.stdout, 1);
    };
    process.stdin.on("data", onData);
    return new Promise((resolve) =>
      rl.question("", (ans) => (process.stdin.removeListener("data", onData), rl.close(), process.stdout.write("\n"), resolve(ans)))
    );
  }
  return new Promise((resolve) => rl.question(question, (ans) => (rl.close(), resolve(ans))));
}

function printTable(rows, cols) {
  if (!rows.length) {
    console.log("(none)");
    return;
  }
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  console.log(cols.map((c, i) => c.padEnd(widths[i])).join("  "));
  for (const r of rows) console.log(cols.map((c, i) => String(r[c] ?? "").padEnd(widths[i])).join("  "));
}

module.exports = { context, api, prompt, printTable };
