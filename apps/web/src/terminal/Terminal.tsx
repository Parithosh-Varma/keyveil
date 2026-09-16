import { useEffect, useRef, useState } from "react";
import { API, api, cleanName, describeApiError, parseFlags, setApiBase, tokenize } from "../lib/kv";

type LineKind = "cmd" | "text" | "status" | "tool" | "ok" | "err" | "warn" | "muted" | "collapse" | "stream";

interface Line {
  id: number;
  kind: LineKind;
  text: string;
  cls?: string;
  summary?: string;
  body?: string;
  open?: boolean;
  cursor?: boolean;
}

interface PaletteAction {
  label: string;
  hint: string;
  run: () => void;
}

const HISTORY_KEY = "kv_hist";

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function Terminal() {
  const [lines, setLines] = useState<Line[]>([]);
  const [value, setValue] = useState("");
  const [inputType, setInputType] = useState("text");
  const [userLabel, setUserLabel] = useState("…");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIdx, setPaletteIdx] = useState(0);

  const idRef = useRef(0);
  const termRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingSecret = useRef<{ name: string } | null>(null);
  const historyRef = useRef<string[]>(loadHistory());
  const histIdx = useRef(historyRef.current.length);
  const booted = useRef(false);
  const [apiBase, setApiBaseState] = useState(API);

  /* ----- line helpers (stable via functional updates) ----- */

  function push(line: Omit<Line, "id">): number {
    const id = ++idRef.current;
    setLines((prev) => [...prev, { ...line, id }]);
    return id;
  }

  function remove(id: number) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  function print(text: string, cls?: string) {
    push({ kind: "text", text, cls });
  }

  function fail(text: string) {
    push({ kind: "err", text: `✗ ${text}` });
  }

  function done(text: string) {
    push({ kind: "ok", text: `✓ ${text}` });
  }

  function setUser(id: string | null) {
    setUserLabel(id ? `user:${id.slice(0, 12)}` : "not logged in");
  }

  async function streamJson(obj: unknown) {
    const full = JSON.stringify(obj, null, 2);
    const id = push({ kind: "stream", text: "", cursor: true });
    for (let i = 2; i <= full.length; i += 6) {
      const snapshot = full.slice(0, i);
      setLines((prev) => prev.map((l) => (l.id === id ? { ...l, text: snapshot } : l)));
      await new Promise((r) => setTimeout(r, 8));
    }
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, text: full, cursor: false } : l)));
  }

  function collapsible(summary: string, body: string) {
    push({ kind: "collapse", text: summary, summary, body, open: false });
  }

  function toggleCollapse(id: number) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, open: !l.open } : l)));
  }

  /* ----- commands ----- */

  async function cmdSecrets(a: { _: string[] }) {
    const sub = a._[0];
    if (sub === "list") {
      const sid = push({ kind: "status", text: "⏺ Reading secret index…" });
      try {
        const r = await api<{ secrets: Array<{ name: string; updated_at: string }> }>("/v1/secrets");
        remove(sid);
        if (!r.secrets.length) return print("  (no secrets yet — secrets add NAME)", "muted");
        push({ kind: "tool", text: ["⏺ Secrets", ...r.secrets.map((x) => `  ⎿  ${x.name}  ·  ${x.updated_at || ""}`)].join("\n") });
      } catch (e) {
        remove(sid);
        fail(describeApiError(e, "secrets list"));
      }
    } else if (sub === "add") {
      const name = cleanName(a._[1]);
      if (!name) return fail("usage: secrets add NAME");
      pendingSecret.current = { name };
      setInputType("password");
      print(`  value for ${name} — type it below (hidden), Enter to store`, "muted");
      inputRef.current?.focus();
    } else if (sub === "get") {
      const name = cleanName(a._[1]);
      if (!name) return fail("usage: secrets get NAME");
      const sid = push({ kind: "status", text: `⏺ Revealing ${name}…` });
      try {
        const r = await api<{ value: string }>(`/v1/secrets/${name}`);
        remove(sid);
        print(`  ${r.value}`);
        print("  visible only here — reveal event logged", "warn");
      } catch (e) {
        remove(sid);
        fail(describeApiError(e, "secrets get"));
      }
    } else if (sub === "delete") {
      const name = cleanName(a._[1]);
      if (!name) return fail("usage: secrets delete NAME");
      try {
        await api(`/v1/secrets/${name}`, { method: "DELETE" });
        done(`Deleted ${name}`);
      } catch (e) {
        fail(describeApiError(e, "secrets delete"));
      }
    } else fail("usage: secrets <list|add|get|delete> [NAME]");
  }

  async function cmdKeys(a: { _: string[] } & Record<string, string | string[]>) {
    const sub = a._[0];
    if (sub === "list") {
      try {
        const r = await api<{ keys: Array<Record<string, string>> }>("/v1/agent-keys");
        if (!r.keys.length) return print("  (no agent keys)", "muted");
        push({
          kind: "tool",
          text: ["⏺ Agent keys", ...r.keys.map((k) => `  ⎿  ${String(k.id).slice(0, 8)}  ${k.name}  ${k.key_prefix}  ${k.revoked_at ? "revoked" : "active"}`)].join("\n"),
        });
        collapsible(`${r.keys.length} keys`, JSON.stringify(r.keys, null, 2));
      } catch (e) {
        fail(describeApiError(e, "keys list"));
      }
    } else if (sub === "create") {
      const str = (v: unknown) => (typeof v === "string" ? v : "");
      const body = {
        name: (str(a.name) || "terminal").slice(0, 64),
        scopes: (str(a.scopes) || "github:create-repo,openai:chat").split(",").map((x) => x.trim()).filter(Boolean),
        ttl_days: Number(str(a.ttl) || 90),
        ip_allowlist: str(a.ips) ? str(a.ips).split(",").map((x) => x.trim()).filter(Boolean) : [],
      };
      const sid = push({ kind: "status", text: "⏺ Creating agent key…" });
      try {
        const r = await api<{ id: string; prefix: string; token: string }>(`/v1/agent-keys`, { method: "POST", body });
        remove(sid);
        print(`  id     ${r.id}`, "muted");
        print(`  prefix ${r.prefix}`, "muted");
        print(`  ${r.token}`, "accent");
        print("  SAVE THIS TOKEN NOW — shown only once", "warn");
      } catch (e) {
        remove(sid);
        fail(describeApiError(e, "keys create"));
      }
    } else if (sub === "revoke") {
      const id = a._[1];
      if (!id) return fail("usage: keys revoke ID");
      try {
        await api(`/v1/agent-keys/${id}/revoke`, { method: "POST" });
        done(`Revoked ${id}`);
      } catch (e) {
        fail(describeApiError(e, "keys revoke"));
      }
    } else fail("usage: keys <list|create|revoke>");
  }

  async function cmdProxy(a: { _: string[] }, raw: string) {
    const [provider, action] = a._;
    if (!provider || !action) return fail(`usage: proxy PROVIDER ACTION '{"k":"v"}'`);
    let data: unknown = {};
    const jsonStart = raw.indexOf("{");
    if (jsonStart >= 0) {
      try {
        data = JSON.parse(raw.slice(jsonStart));
      } catch {
        return fail("third argument must be valid JSON");
      }
    }
    const sid = push({ kind: "status", text: `⏺ Calling ${provider}/${action}…` });
    push({ kind: "tool", text: `⏺ POST /v1/proxy/${provider}/${action}\n  ⎿  injecting secret server-side\n  ⎿  waiting for result` });
    try {
      const r = await api(`/v1/proxy/${provider}/${action}`, { method: "POST", body: data });
      remove(sid);
      await streamJson(r);
    } catch (e) {
      remove(sid);
      fail(describeApiError(e, "proxy"));
    }
  }

  async function dispatch(rawLine: string) {
    const line = rawLine.trim();
    if (pendingSecret.current) {
      const { name } = pendingSecret.current;
      pendingSecret.current = null;
      setInputType("text");
      if (!line) return fail("empty value — nothing stored");
      const sid = push({ kind: "status", text: `⏺ Storing ${name}…` });
      try {
        await api("/v1/secrets", { method: "POST", body: { name, value: line } });
        remove(sid);
        print(`  @@ secret ${name}`, "muted");
        print("  + encrypted server-side", "diff-add");
        done(`Stored ${name}`);
      } catch (e) {
        remove(sid);
        fail(describeApiError(e, "secrets add"));
      }
      return;
    }
    if (!line) return;
    historyRef.current.push(line);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(historyRef.current.slice(-200)));
    } catch {
      /* private mode */
    }
    histIdx.current = historyRef.current.length;
    push({ kind: "cmd", text: line });

    const tokens = tokenize(line);
    const [name, ...rest] = tokens;
    const a = parseFlags(rest);
    try {
      switch (name) {
        case "help":
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
              `  proxy PROVIDER ACTION '{"k":"v"}'   blind call, result only`,
              "  tools                  allowed proxy tools",
              "  audit                  last events (metadata only)",
              "  api [URL]              show or switch API endpoint",
              "  clear                  clear the terminal",
            ].join("\n"),
            "muted"
          );
          break;
        case "login": {
          const sid = push({ kind: "status", text: "⏺ Contacting Google…" });
          try {
            const r = await api<{ url: string }>("/v1/auth/google/start");
            setLines((prev) => prev.map((l) => (l.id === sid ? { ...l, text: "⏺ Redirecting to Google…" } : l)));
            location.href = r.url;
          } catch (e) {
            remove(sid);
            fail(describeApiError(e, "login"));
          }
          break;
        }
        case "logout":
          try {
            await api("/v1/auth/logout", { method: "POST" });
            setUser(null);
            done("Logged out");
          } catch (e) {
            fail(describeApiError(e, "logout"));
          }
          break;
        case "whoami":
          try {
            const me = await api<{ user_id: string; via: string; scopes: string[] }>("/v1/whoami");
            setUser(me.user_id);
            print(`  ${me.user_id}  via ${me.via}`);
            print(`  scopes: ${me.scopes.join(", ") || "(none)"}`, "muted");
          } catch (e) {
            fail(describeApiError(e, "whoami"));
          }
          break;
        case "secrets":
          await cmdSecrets(a);
          break;
        case "keys":
          await cmdKeys(a);
          break;
        case "proxy":
          await cmdProxy(a, line);
          break;
        case "tools": {
          try {
            const r = await api<{ tools: Array<{ provider: string; action: string; description: string }> }>("/v1/tools");
            push({ kind: "tool", text: ["⏺ Tools", ...r.tools.map((t) => `  ⎿  ${t.provider}/${t.action} — ${t.description}`)].join("\n") });
          } catch (e) {
            fail(describeApiError(e, "tools"));
          }
          break;
        }
        case "audit": {
          const sid = push({ kind: "status", text: "⏺ Reading audit log…" });
          try {
            const r = await api<{ audit: Array<Record<string, string | number>> }>("/v1/audit");
            remove(sid);
            if (!r.audit.length) {
              print("  (no events)", "muted");
              break;
            }
            const rows = r.audit
              .slice(0, 12)
              .map((x) => `  ⎿  ${x.created_at}  ${x.actor}  ${x.provider || "-"}  ${x.action}  ${x.ok ? "ok" : "FAIL"}`);
            push({ kind: "tool", text: ["⏺ Audit", ...rows].join("\n") });
            if (r.audit.length > 12) collapsible(`${r.audit.length - 12} more`, JSON.stringify(r.audit.slice(12), null, 2));
          } catch (e) {
            remove(sid);
            fail(describeApiError(e, "audit"));
          }
          break;
        }
        case "api":
          if (a._[0]) {
            const next = setApiBase(a._[0]);
            setApiBaseState(next);
            done(`API → ${next}`);
          } else {
            print(`  ${apiBase}`, "muted");
          }
          break;
        case "clear":
          setLines([]);
          break;
        default:
          fail(`unknown command: ${name} — type help`);
      }
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }

  /* ----- input ----- */

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      const v = value;
      setValue("");
      void dispatch(v);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (histIdx.current > 0) setValue(historyRef.current[--histIdx.current] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (histIdx.current < historyRef.current.length) setValue(historyRef.current[++histIdx.current] || "");
      else setValue("");
    } else if (e.key === "Escape") {
      setValue("");
      pendingSecret.current = null;
      setInputType("text");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    } else if (e.key === "k" && e.ctrlKey) {
      e.preventDefault();
      setPaletteOpen(true);
      setPaletteQuery("");
      setPaletteIdx(0);
    }
  }

  /* ----- palette ----- */

  const paletteActions: PaletteAction[] = [
    { label: "Run command", hint: "help", run: () => void dispatch("help") },
    { label: "Sign in with Google", hint: "login", run: () => void dispatch("login") },
    { label: "List secrets", hint: "secrets list", run: () => void dispatch("secrets list") },
    { label: "List agent keys", hint: "keys list", run: () => void dispatch("keys list") },
    { label: "View audit log", hint: "audit", run: () => void dispatch("audit") },
    { label: "List proxy tools", hint: "tools", run: () => void dispatch("tools") },
    { label: "Clear terminal", hint: "clear", run: () => void dispatch("clear") },
  ];
  const paletteItems = paletteActions.filter((act) =>
    act.label.toLowerCase().includes(paletteQuery.toLowerCase())
  );

  /* ----- effects ----- */

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    push({ kind: "text", text: "keyveil — blind secrets gateway", cls: "muted" });
    push({ kind: "text", text: "type help to begin", cls: "muted" });
    const params = new URLSearchParams(location.search);
    if (params.get("login") === "ok") {
      history.replaceState(null, "", location.pathname);
      push({ kind: "text", text: "" });
      push({ kind: "ok", text: "✓ Signed in with Google" });
    }
    if (location.hash === "#login") {
      history.replaceState(null, "", location.pathname);
      void dispatch("login");
      return;
    }
    api<{ user_id: string }>("/v1/whoami")
      .then((me) => {
        setUser(me.user_id);
        push({ kind: "text", text: `  session: ${me.user_id.slice(0, 12)}`, cls: "muted" });
      })
      .catch(() => setUser(null));
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ----- render ----- */

  return (
    <>
      <div id="statusline">
        <span id="cwd">~/keyveil</span>
        <span id="flags">
          <span className="dot-ok">●</span> api
        </span>
        <span id="user">{userLabel}</span>
      </div>
      <main id="term" aria-live="polite" ref={termRef} onClick={() => inputRef.current?.focus()}>
        {lines.map((l) => (
          <LineView key={l.id} line={l} onToggle={() => toggleCollapse(l.id)} />
        ))}
      </main>
      <div id="inputrow">
        <span id="prompt">❯</span>
        <input
          id="cmd"
          ref={inputRef}
          type={inputType}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="command input"
        />
      </div>
      <div id="hint">Enter submit · Esc clear · ↑↓ history · Ctrl+K commands · Ctrl+L clear</div>
      {paletteOpen && (
        <div id="palette" onClick={() => setPaletteOpen(false)}>
          <div id="palette-box" onClick={(e) => e.stopPropagation()}>
            <div id="palette-row">
              <span>&gt;</span>
              <input
                id="palette-input"
                autoFocus
                value={paletteQuery}
                onChange={(e) => {
                  setPaletteQuery(e.target.value);
                  setPaletteIdx(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setPaletteOpen(false);
                  else if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setPaletteIdx((i) => Math.min(i + 1, paletteItems.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setPaletteIdx((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter") {
                    const act = paletteItems[paletteIdx];
                    if (act) {
                      setPaletteOpen(false);
                      setPaletteIdx(0);
                      act.run();
                    }
                  }
                }}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div id="palette-list">
              {paletteItems.map((act, i) => (
                <div
                  key={act.hint}
                  className={`palette-item${i === paletteIdx ? " active" : ""}`}
                  onClick={() => {
                    setPaletteOpen(false);
                    setPaletteIdx(0);
                    act.run();
                  }}
                >
                  {act.label}
                  <span className="k">{act.hint}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LineView({ line, onToggle }: { line: Line; onToggle: () => void }) {
  if (line.kind === "cmd") {
    return (
      <div className="turn">
        <div className="cmdline">
          <span className="p">❯</span>
          {line.text}
        </div>
      </div>
    );
  }
  if (line.kind === "collapse") {
    return (
      <div>
        {line.summary}
        {"\n     "}
        <button className="expand" onClick={onToggle}>
          {line.open ? "[collapse]" : "[expand output]"}
        </button>
        {line.open && <span className="collapsed-body" style={{ display: "block" }}>{`\n${line.body}`}</span>}
      </div>
    );
  }
  const cls = [line.kind === "text" ? undefined : line.kind, line.cls, line.cursor ? "cursor" : ""]
    .filter(Boolean)
    .join(" ");
  return <div className={cls || undefined}>{line.text}</div>;
}
