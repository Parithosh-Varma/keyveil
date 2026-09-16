/* keyveil terminal — command loop, agent-style output, palette, history. */
"use strict";

const PROD_API = "https://keyveil-api.parithosh.workers.dev";
const LOCAL_API = "http://127.0.0.1:8787";
const isLocalHost = ["localhost", "127.0.0.1"].includes(location.hostname);
let API = localStorage.getItem("api_base") || (isLocalHost ? LOCAL_API : PROD_API);

const term = document.getElementById("term");
const input = document.getElementById("cmd");
const userFlag = document.getElementById("user");
const flagsFlag = document.getElementById("flags");
const history = JSON.parse(localStorage.getItem("kv_hist") || "[]");
let histIdx = history.length;
let pendingSecret = null; // { name } when next submit is a hidden value

/* ---------- output primitives ---------- */

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function print(html, cls) {
  const div = document.createElement("div");
  if (cls) div.className = cls;
  div.innerHTML = html;
  term.appendChild(div);
  term.scrollTop = term.scrollHeight;
  return div;
}

function echoCmd(text) {
  const turn = document.createElement("div");
  turn.className = "turn";
  turn.innerHTML = `<div class="cmdline"><span class="p">❯</span>${esc(text)}</div>`;
  term.appendChild(turn);
  return turn;
}

function status(text) {
  return print(`⏺ ${esc(text)}`);
}

function tool(name, lines) {
  let html = `⏺ ${esc(name)}\n`;
  for (const l of lines || []) html += `\n  ⎿  ${esc(l)}`;
  return print(html, "tool");
}

function fail(text) {
  print(`✗ ${esc(text)}`, "err");
}

function done(text) {
  print(`✓ ${esc(text)}`, "ok");
}

function collapsible(summary, body) {
  const id = "c" + Math.random().toString(36).slice(2, 8);
  const div = print(
    `${esc(summary)}\n     <button class="expand" data-t="${id}">[expand output]</button>\n<span class="collapsed-body" id="${id}">${esc(body)}</span>`
  );
  div.querySelector("button").onclick = (e) => {
    const bodyEl = document.getElementById(e.target.dataset.t);
    const open = bodyEl.style.display === "block";
    bodyEl.style.display = open ? "none" : "block";
    e.target.textContent = open ? "[expand output]" : "[collapse]";
    term.scrollTop = term.scrollHeight;
  };
}

async function streamInto(node, text, chunk = 3) {
  node.classList.add("cursor");
  let shown = "";
  for (let i = 0; i < text.length; i += chunk) {
    shown = text.slice(0, i + chunk);
    node.innerHTML = esc(shown);
    if (i % 48 === 0) await new Promise((r) => setTimeout(r, 8));
  }
  node.classList.remove("cursor");
}

/* ---------- api ---------- */

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(API + path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.need = data.need;
    throw err;
  }
  return data;
}

function apiError(e, what) {
  if (e.status === 401) fail(`${what}: not logged in — type login`);
  else if (e.status === 403) fail(`${what}: denied${e.need ? ` (need scope: ${e.need})` : ""}`);
  else if (e instanceof TypeError) fail(`${what}: cannot reach ${API}`);
  else fail(`${what}: ${e.message}`);
}

/* ---------- parsing ---------- */

function tokenize(line) {
  const m = line.match(/"([^"]*)"|'([^']*)'|\S+/g) || [];
  return m.map((t) => t.replace(/^["']|["']$/g, ""));
}

function flags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const k = args[i].slice(2);
      out[k] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    } else out._.push(args[i]);
  }
  return out;
}

/* ---------- commands ---------- */

const commands = {
  help: {
    usage: "help",
    about: "List commands",
    async run() {
      print(
        [
          "commands",
          "  login                  sign in with Google",
          "  logout                 end this session",
          "  whoami                 session identity",
          "  secrets list           secret names (metadata only)",
          "  secrets add NAME       store value (hidden prompt)",
          "  secrets get NAME       print value (audited reveal)",
          "  secrets delete NAME    delete a secret",
          "  keys list              agent key metadata",
          "  keys create [--name N] [--scopes a,b] [--ttl days] [--ips a,b]",
          "  keys revoke ID         revoke a key",
          "  proxy PROVIDER ACTION '{\"k\":\"v\"}'   blind call, result only",
          "  tools                  allowed proxy tools",
          "  audit                  last events (metadata only)",
          "  api [URL]              show or switch API endpoint",
          "  clear                  clear the terminal",
        ].join("\n"),
        "muted"
      );
    },
  },

  login: {
    usage: "login",
    about: "Sign in with Google",
    async run() {
      const s = status("Contacting Google…");
      try {
        const r = await api("/v1/auth/google/start");
        s.innerHTML = `⏺ Redirecting to Google…`;
        location.href = r.url;
      } catch (e) {
        s.remove();
        apiError(e, "login");
      }
    },
  },

  logout: {
    usage: "logout",
    about: "End this session",
    async run() {
      try {
        await api("/v1/auth/logout", { method: "POST" });
        setUser(null);
        done("Logged out");
      } catch (e) {
        apiError(e, "logout");
      }
    },
  },

  whoami: {
    usage: "whoami",
    about: "Session identity",
    async run() {
      try {
        const me = await api("/v1/whoami");
        setUser(me.user_id);
        print(`  ${esc(me.user_id)}  via ${esc(me.via)}`);
        if (me.scopes) print(`  scopes: ${esc(me.scopes.join(", ") || "(none)")}`, "muted");
      } catch (e) {
        apiError(e, "whoami");
      }
    },
  },

  secrets: {
    usage: "secrets <list|add|get|delete> [NAME]",
    about: "Manage secrets",
    async run(a) {
      const sub = a._[0];
      if (sub === "list") {
        const s = status("Reading secret index…");
        try {
          const r = await api("/v1/secrets");
          s.remove();
          if (!r.secrets.length) return print("  (no secrets yet — secrets add NAME)", "muted");
          tool("Secrets", r.secrets.map((x) => `${x.name}  ·  ${x.updated_at || ""}`));
        } catch (e) {
          s.remove();
          apiError(e, "secrets list");
        }
      } else if (sub === "add") {
        const name = cleanName(a._[1]);
        if (!name) return fail("usage: secrets add NAME");
        pendingSecret = { name };
        input.type = "password";
        print(`  value for ${esc(name)} — type it below (hidden), Enter to store`, "muted");
        input.focus();
      } else if (sub === "get") {
        const name = cleanName(a._[1]);
        if (!name) return fail("usage: secrets get NAME");
        const s = status(`Revealing ${name}…`);
        try {
          const r = await api(`/v1/secrets/${name}`);
          s.remove();
          print(`  ${esc(r.value)}`);
          print("  visible only here — reveal event logged", "warn");
        } catch (e) {
          s.remove();
          apiError(e, "secrets get");
        }
      } else if (sub === "delete") {
        const name = cleanName(a._[1]);
        if (!name) return fail("usage: secrets delete NAME");
        try {
          await api(`/v1/secrets/${name}`, { method: "DELETE" });
          done(`Deleted ${name}`);
        } catch (e) {
          apiError(e, "secrets delete");
        }
      } else fail("usage: secrets <list|add|get|delete> [NAME]");
    },
  },

  keys: {
    usage: "keys <list|create|revoke>",
    about: "Manage agent keys",
    async run(a) {
      const sub = a._[0];
      if (sub === "list") {
        try {
          const r = await api("/v1/agent-keys");
          if (!r.keys.length) return print("  (no agent keys)", "muted");
          tool(
            "Agent keys",
            r.keys.map(
              (k) =>
                `${k.id.slice(0, 8)}  ${k.name}  ${k.key_prefix}  ${k.revoked_at ? "revoked" : "active"}`
            )
          );
          collapsible(`${r.keys.length} keys`, JSON.stringify(r.keys, null, 2));
        } catch (e) {
          apiError(e, "keys list");
        }
      } else if (sub === "create") {
        const body = {
          name: (a.name || "terminal").slice(0, 64),
          scopes: (a.scopes || "github:create-repo,openai:chat").split(",").map((x) => x.trim()).filter(Boolean),
          ttl_days: Number(a.ttl || 90),
          ip_allowlist: a.ips ? a.ips.split(",").map((x) => x.trim()).filter(Boolean) : [],
        };
        const s = status("Creating agent key…");
        try {
          const r = await api("/v1/agent-keys", { method: "POST", body });
          s.remove();
          print(`  id     ${esc(r.id)}`, "muted");
          print(`  prefix ${esc(r.prefix)}`, "muted");
          print(`  ${esc(r.token)}`, "accent");
          print("  SAVE THIS TOKEN NOW — shown only once", "warn");
        } catch (e) {
          s.remove();
          apiError(e, "keys create");
        }
      } else if (sub === "revoke") {
        const id = a._[1];
        if (!id) return fail("usage: keys revoke ID");
        try {
          await api(`/v1/agent-keys/${id}/revoke`, { method: "POST" });
          done(`Revoked ${id}`);
        } catch (e) {
          apiError(e, "keys revoke");
        }
      } else fail("usage: keys <list|create|revoke>");
    },
  },

  proxy: {
    usage: "proxy PROVIDER ACTION '{\"k\":\"v\"}'",
    about: "Blind proxy call",
    async run(a, raw) {
      const [provider, action] = a._;
      if (!provider || !action) return fail("usage: proxy PROVIDER ACTION '{\"k\":\"v\"}'");
      let data = {};
      const jsonStart = raw.indexOf("{");
      if (jsonStart >= 0) {
        try {
          data = JSON.parse(raw.slice(jsonStart));
        } catch {
          return fail("third argument must be valid JSON");
        }
      }
      const s = status(`Calling ${provider}/${action}…`);
      tool(`POST /v1/proxy/${provider}/${action}`, ["injecting secret server-side", "waiting for result"]);
      try {
        const r = await api(`/v1/proxy/${provider}/${action}`, { method: "POST", body: data });
        s.remove();
        const node = print("", "out");
        await streamInto(node, JSON.stringify(r, null, 2));
      } catch (e) {
        s.remove();
        apiError(e, "proxy");
      }
    },
  },

  tools: {
    usage: "tools",
    about: "Allowed proxy tools",
    async run() {
      try {
        const r = await api("/v1/tools");
        tool(
          "Tools",
          r.tools.map((t) => `${t.provider}/${t.action} — ${t.description}`)
        );
      } catch (e) {
        apiError(e, "tools");
      }
    },
  },

  audit: {
    usage: "audit",
    about: "Recent events",
    async run() {
      const s = status("Reading audit log…");
      try {
        const r = await api("/v1/audit");
        s.remove();
        if (!r.audit.length) return print("  (no events)", "muted");
        const rows = r.audit.slice(0, 12).map((x) => `${x.created_at}  ${x.actor}  ${x.provider || "-"}  ${x.action}  ${x.ok ? "ok" : "FAIL"}`);
        tool("Audit", rows);
        if (r.audit.length > 12) collapsible(`${r.audit.length - 12} more`, JSON.stringify(r.audit.slice(12), null, 2));
      } catch (e) {
        s.remove();
        apiError(e, "audit");
      }
    },
  },

  api: {
    usage: "api [URL]",
    about: "Show or switch API endpoint",
    async run(a) {
      if (a._[0]) {
        API = a._[0].replace(/\/$/, "");
        localStorage.setItem("api_base", API);
        done(`API → ${API}`);
      } else print(`  ${esc(API)}`, "muted");
    },
  },

  clear: {
    usage: "clear",
    about: "Clear the terminal",
    async run() {
      term.innerHTML = "";
    },
  },
};

function cleanName(n) {
  const c = String(n || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 64);
  return c || null;
}

function setUser(id) {
  userFlag.innerHTML = id ? `user:${esc(id.slice(0, 12))}` : "not logged in";
  flagsFlag.innerHTML = `<span class="dot-ok">●</span> api`;
}

/* ---------- main loop ---------- */

async function dispatch(rawLine) {
  const line = rawLine.trim();
  if (pendingSecret) {
    const { name } = pendingSecret;
    pendingSecret = null;
    input.type = "text";
    if (!line) return fail("empty value — nothing stored");
    const s = status(`Storing ${name}…`);
    try {
      await api("/v1/secrets", { method: "POST", body: { name, value: line } });
      s.remove();
      print(`  @@ secret ${esc(name)}`, "muted");
      print(`  + encrypted server-side`, "diff-add");
      done(`Stored ${name}`);
    } catch (e) {
      s.remove();
      apiError(e, "secrets add");
    }
    return;
  }
  if (!line) return;
  history.push(line);
  localStorage.setItem("kv_hist", JSON.stringify(history.slice(-200)));
  histIdx = history.length;
  echoCmd(line);
  const tokens = tokenize(line);
  const cmd = commands[tokens[0]];
  if (!cmd) return fail(`unknown command: ${tokens[0]} — type help`);
  try {
    await cmd.run(flags(tokens.slice(1)), line);
  } catch (e) {
    fail(e.message);
  }
}

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const v = input.value;
    input.value = "";
    dispatch(v);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (histIdx > 0) input.value = history[--histIdx] || "";
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    if (histIdx < history.length) input.value = history[++histIdx] || "";
    else input.value = "";
  } else if (e.key === "Escape") {
    input.value = "";
    pendingSecret = null;
    input.type = "text";
  } else if (e.key === "l" && e.ctrlKey) {
    e.preventDefault();
    term.innerHTML = "";
  } else if (e.key === "k" && e.ctrlKey) {
    e.preventDefault();
    openPalette();
  }
});

document.addEventListener("click", (e) => {
  if (e.target.classList && e.target.classList.contains("fileref")) {
    print(`  ${e.target.textContent} — open it in your editor`, "muted");
  } else if (!palette.hidden) {
    // keep focus handling simple: clicking outside closes
  } else input.focus();
});

/* ---------- palette ---------- */

const palette = document.getElementById("palette");
const paletteInput = document.getElementById("palette-input");
const paletteList = document.getElementById("palette-list");
const paletteActions = [
  { label: "Run command", hint: "help", run: () => dispatch("help") },
  { label: "Sign in with Google", hint: "login", run: () => dispatch("login") },
  { label: "List secrets", hint: "secrets list", run: () => dispatch("secrets list") },
  { label: "List agent keys", hint: "keys list", run: () => dispatch("keys list") },
  { label: "View audit log", hint: "audit", run: () => dispatch("audit") },
  { label: "List proxy tools", hint: "tools", run: () => dispatch("tools") },
  { label: "Clear terminal", hint: "clear", run: () => dispatch("clear") },
];
let paletteIdx = 0;

function openPalette() {
  palette.hidden = false;
  paletteInput.value = "";
  renderPalette("");
  paletteInput.focus();
}
function closePalette() {
  palette.hidden = true;
  input.focus();
}
function renderPalette(q) {
  const items = paletteActions.filter((a) => a.label.toLowerCase().includes(q.toLowerCase()));
  paletteIdx = Math.min(paletteIdx, Math.max(items.length - 1, 0));
  paletteList.innerHTML = items
    .map((a, i) => `<div class="palette-item${i === paletteIdx ? " active" : ""}" data-i="${i}">${esc(a.label)}<span class="k">${esc(a.hint)}</span></div>`)
    .join("");
  paletteList.querySelectorAll(".palette-item").forEach((el) => {
    el.onclick = () => {
      const a = items[Number(el.dataset.i)];
      closePalette();
      paletteIdx = 0;
      a.run();
    };
  });
  return items;
}
let paletteItems = [];
paletteInput.addEventListener("input", () => {
  paletteIdx = 0;
  paletteItems = renderPalette(paletteInput.value);
});
paletteInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closePalette();
  else if (e.key === "ArrowDown") {
    e.preventDefault();
    paletteIdx = Math.min(paletteIdx + 1, paletteItems.length - 1);
    renderPalette(paletteInput.value);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    paletteIdx = Math.max(paletteIdx - 1, 0);
    renderPalette(paletteInput.value);
  } else if (e.key === "Enter") {
    const a = paletteItems[paletteIdx];
    if (a) {
      closePalette();
      paletteIdx = 0;
      a.run();
    }
  }
});

/* ---------- boot ---------- */

(async function boot() {
  print("keyveil — blind secrets gateway", "muted");
  print("type help to begin", "muted");
  const params = new URLSearchParams(location.search);
  if (params.get("login") === "ok") {
    history.replaceState(null, "", location.pathname);
    print("", "");
    done("Signed in with Google");
  }
  if (location.hash === "#login") {
    history.replaceState(null, "", location.pathname);
    dispatch("login");
    return;
  }
  try {
    const me = await api("/v1/whoami");
    setUser(me.user_id);
    print(`  session: ${esc(me.user_id.slice(0, 12))}`, "muted");
  } catch {
    setUser(null);
  }
  input.focus();
})();
