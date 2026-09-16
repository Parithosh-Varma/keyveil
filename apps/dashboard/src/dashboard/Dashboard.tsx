import { useCallback, useEffect, useRef, useState } from "react";
import {
  API,
  api,
  cleanName,
  clearSessionToken,
  describeApiError,
  saveSessionToken,
  setApiBase,
} from "../../../shared/kv";
import { GoogleButton } from "../../../shared/GoogleButton";

interface SecretRow {
  name: string;
  preview: string | null;
  updated_at: string;
  last_used: string | null;
}
interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string;
  ip_allowlist: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}
interface AuditRow {
  actor: string;
  provider: string | null;
  action: string;
  ok: number;
  ip: string;
  created_at: string;
}
interface ToolRow {
  provider: string;
  action: string;
  description: string;
}
interface Me {
  user_id: string;
  name: string | null;
  picture: string | null;
}

type View = "secrets" | "keys" | "activity" | "tools";

const NAV: Array<{ id: View; label: string; icon: JSX.Element }> = [
  {
    id: "secrets",
    label: "API keys",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="15" r="4" />
        <path d="M10.9 12.1 21 2m-4 2 3 3m-6 0 3 3" />
      </svg>
    ),
  },
  {
    id: "keys",
    label: "Agent keys",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" />
      </svg>
    ),
  },
  {
    id: "activity",
    label: "Activity",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12h4l3 8 4-16 3 8h4" />
      </svg>
    ),
  },
  {
    id: "tools",
    label: "Proxy actions",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7z" />
      </svg>
    ),
  },
];

export function Dashboard() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const [view, setView] = useState<View>("secrets");
  const [apiBase, setApiBaseUi] = useState(API);
  const [banner, setBanner] = useState<{ kind: "err" | "ok"; text: string } | null>(null);

  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [keyName, setKeyName] = useState("opencode");
  const [keyTtl, setKeyTtl] = useState("90");
  const [keyIps, setKeyIps] = useState("");
  const [createdToken, setCreatedToken] = useState<{ id: string; prefix: string; token: string } | null>(null);

  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [tools, setTools] = useState<ToolRow[]>([]);

  const activeKeys = keys.filter((k) => !k.revoked_at).length;
  const secretsCount = useCountUp(secrets.length);
  const keysCount = useCountUp(activeKeys);
  const auditCount = useCountUp(audit.length);

  function note(kind: "err" | "ok", text: string) {
    setBanner({ kind, text });
  }

  const refresh = useCallback(async () => {
    try {
      const who = await api<Me & { user_id: string }>("/v1/whoami");
      setMe({ user_id: who.user_id, name: who.name, picture: who.picture });
      const [s, k, a, t] = await Promise.all([
        api<{ secrets: SecretRow[] }>("/v1/secrets"),
        api<{ keys: KeyRow[] }>("/v1/agent-keys").catch(() => ({ keys: [] as KeyRow[] })),
        api<{ audit: AuditRow[] }>("/v1/audit").catch(() => ({ audit: [] as AuditRow[] })),
        api<{ tools: ToolRow[] }>("/v1/tools"),
      ]);
      setSecrets(s.secrets);
      setKeys(k.keys);
      setAudit(a.audit);
      setTools(t.tools);
    } catch {
      setMe(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const params = new URLSearchParams(location.search);
      if (params.get("start") === "login") {
        history.replaceState(null, "", location.pathname);
        await login();
        return;
      }
      const grant = params.get("grant");
      if (grant) {
        // Cookie-less handoff: trade the one-time grant for a session token,
        // but only if the echoed state matches the one this tab generated.
        // A state an attacker initiated can never complete here.
        const echoed = params.get("state") || "";
        let expected = "";
        try {
          expected = localStorage.getItem("kv_oauth_state") || "";
          localStorage.removeItem("kv_oauth_state");
        } catch {
          /* private mode */
        }
        history.replaceState(null, "", location.pathname);
        if (!expected || echoed !== expected) {
          note("err", "Sign-in response did not match this tab — please sign in again.");
        } else {
          try {
            const r = await api<{ session_token: string }>("/v1/auth/grant", {
              method: "POST",
              body: { code: grant },
            });
            saveSessionToken(r.session_token);
          } catch {
            note("err", "Sign-in handoff expired — please sign in again.");
          }
        }
      } else if (params.get("login") === "ok") {
        history.replaceState(null, "", location.pathname);
        note("ok", "Signed in with Google.");
      }
      await refresh();
    })();
  }, [refresh]);

  async function login() {
    try {
      // This tab's own CSRF state: random, stored locally, recorded server-side.
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      const state = btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      try {
        localStorage.setItem("kv_oauth_state", state);
      } catch {
        /* private mode */
      }
      const r = await api<{ url: string }>(`/v1/auth/google/start?s=${state}`);
      location.href = r.url;
    } catch (e) {
      note("err", describeApiError(e, "Login"));
    }
  }

  async function logout() {
    try {
      await api("/v1/auth/logout", { method: "POST" });
    } catch {
      /* session may already be gone */
    }
    clearSessionToken();
    setMe(null);
    setSecrets([]);
    setKeys([]);
    setAudit([]);
    setRevealed({});
    setCreatedToken(null);
  }

  async function addSecret(e: React.FormEvent) {
    e.preventDefault();
    const name = cleanName(newName);
    if (!name) return note("err", "Secret names use A–Z, 0–9 and underscore.");
    if (newValue.trim().length < 3) return note("err", "Value is too short.");
    try {
      await api("/v1/secrets", { method: "POST", body: { name, value: newValue.trim() } });
      setNewName("");
      setNewValue("");
      note("ok", `${name} stored encrypted.`);
      void refresh();
    } catch (err) {
      note("err", describeApiError(err, "Store"));
    }
  }

  async function reveal(name: string) {
    try {
      const r = await api<{ value: string }>(`/v1/secrets/${name}`);
      setRevealed((prev) => ({ ...prev, [name]: r.value }));
      // Revealed values live in DOM memory: auto-hide after 60s so a
      // walked-away-from screen stops displaying raw secrets.
      window.setTimeout(() => {
        setRevealed((prev) => {
          if (!(name in prev)) return prev;
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }, 60_000);
    } catch (e) {
      note("err", describeApiError(e, "Reveal"));
    }
  }

  function hide(name: string) {
    setRevealed((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  async function removeSecret(name: string) {
    if (!window.confirm(`Delete ${name}? Agents using it will fail.`)) return;
    try {
      await api(`/v1/secrets/${name}`, { method: "DELETE" });
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      note("ok", `${name} deleted.`);
      void refresh();
    } catch (e) {
      note("err", describeApiError(e, "Delete"));
    }
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    const ips = keyIps.split(",").map((s) => s.trim()).filter(Boolean);
    for (const ip of ips) {
      if (!isValidIpRule(ip)) return note("err", `Bad IP "${ip}" — use IPv4 or x.x.x.0/24.`);
    }
    const ttl = Math.min(Math.max(Math.floor(Number(keyTtl)) || 90, 1), 365);
    setKeyTtl(String(ttl));
    try {
      const r = await api<{ id: string; prefix: string; token: string; scopes: string[] }>("/v1/agent-keys", {
        method: "POST",
        body: { name: keyName.trim() || "terminal", ttl_days: ttl, ip_allowlist: ips },
      });
      setCreatedToken({ id: r.id, prefix: r.prefix, token: r.token });
      // One-time token display: wipe after 5 minutes even if never dismissed.
      window.setTimeout(() => setCreatedToken((t) => (t && t.id === r.id ? null : t)), 300_000);
      note("ok", "Key created — copy the token now, it is shown once.");
      void refresh();
    } catch (err) {
      note("err", describeApiError(err, "Create key"));
    }
  }

  async function revokeKey(id: string, name: string) {
    if (!window.confirm(`Revoke key "${name}"? It stops working immediately.`)) return;
    try {
      await api(`/v1/agent-keys/${id}/revoke`, { method: "POST" });
      note("ok", `Revoked ${name}.`);
      void refresh();
    } catch (e) {
      note("err", describeApiError(e, "Revoke"));
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      note("ok", `${label} copied.`);
    } catch {
      note("err", "Copy blocked — select the text manually.");
    }
  }

  function switchApi(url: string) {
    try {
      setApiBaseUi(setApiBase(url));
    } catch {
      note("err", "Unknown API — keeping current endpoint.");
      return;
    }
    clearSessionToken();
    setMe(null);
    setChecking(true);
    void refresh();
  }

  if (checking) {
    return (
      <div className="dash">
        <div className="loading">
          <span className="spinner" aria-hidden="true" />
          <p>Checking session…</p>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="dash">
        <header className="dash-nav">
          <a className="wordmark" href="./">
            <img className="brandmark" src="/logo-mark.png" alt="KeyVeil mark" width="24" height="24" />
            <span>keyveil</span>
          </a>
          <span className="env-pill">{apiBase.includes("127.0.0.1") ? "local API" : "production"}</span>
        </header>
        <main className="signin-wrap">
          <div className="signin-card">
            <img className="signin-mark" src="/app-icon.png" alt="KeyVeil" width="64" height="64" />
            <p className="eyebrow">KeyVeil dashboard</p>
            <h1>Sign in to manage your keys</h1>
            <p className="lede">
              One Google account, full control: stored secrets, scoped agent tokens, and every event —
              without ever pasting a key into a chat.
            </p>
            <GoogleButton onClick={() => void login()} />
            {banner && <p className={banner.kind === "err" ? "err" : "ok"}>{banner.text}</p>}
            <ul className="signin-points">
              <li>AES-256-GCM encryption at rest</li>
              <li>Scoped, expiring agent tokens</li>
              <li>Every reveal audit-logged</li>
            </ul>
            <p className="muted small">
              Pointing at {apiBase} ·{" "}
              <button className="linklike" type="button" onClick={() => switchApi("http://127.0.0.1:8787")}>
                use local API
              </button>
            </p>
          </div>
        </main>
      </div>
    );
  }

  const initials = (me.name || me.user_id).slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="wordmark" href="./">
          <img className="brandmark" src="/logo-mark.png" alt="KeyVeil mark" width="24" height="24" />
          <span>keyveil</span>
        </a>
        <nav className="side-nav" aria-label="Dashboard sections">
          {NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`side-item${view === item.id ? " active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              <span className="side-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <div className="profile">
            {me.picture && me.picture.startsWith("https://") ? (
              <img className="avatar" src={me.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span className="avatar fallback" aria-hidden="true">
                {initials}
              </span>
            )}
            <span className="profile-meta">
              <strong>{me.name || "Account"}</strong>
              <span className="muted small">{apiBase.includes("127.0.0.1") ? "local API" : "production"}</span>
            </span>
          </div>
          <button className="btn ghost wide" type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </aside>

      <div className="content">
        <header className="content-head">
          <div>
            <h1>{viewTitle(view)}</h1>
            <p className="muted">{viewSub(view)}</p>
          </div>
          <span className="env-pill">{apiBase.includes("127.0.0.1") ? "local API" : "production"}</span>
        </header>

        {banner && (
          <p className={`banner ${banner.kind}`} role="status">
            {banner.text}
          </p>
        )}

        <section className="stats" aria-label="Overview">
          <div className="stat">
            <span className="stat-num">{secretsCount}</span>
            <span className="stat-label">API keys stored</span>
          </div>
          <div className="stat">
            <span className="stat-num">{keysCount}</span>
            <span className="stat-label">Active agent keys</span>
          </div>
          <div className="stat">
            <span className="stat-num">{auditCount}</span>
            <span className="stat-label">Events logged</span>
          </div>
        </section>

        {view === "secrets" && (
          <section className="card">
            <form className="row-form" onSubmit={(e) => void addSecret(e)}>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="NAME_LIKE_THIS" aria-label="Secret name" />
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Value — hidden from logs" type="password" aria-label="Secret value" />
              <button className="btn primary" type="submit">
                Store key
              </button>
            </form>
            {secrets.length === 0 ? (
              <div className="empty">
                <p>No keys yet.</p>
                <p className="muted small">Store your first one above — it is encrypted before it touches the database.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Preview</th>
                    <th>Updated</th>
                    <th>Value</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {secrets.map((s) => (
                    <tr key={s.name}>
                      <td>
                        <code>{s.name}</code>
                      </td>
                      <td className="muted small">
                        <code>{s.preview || "—"}</code>
                      </td>
                      <td className="muted small">{s.updated_at?.slice(0, 10) || "—"}</td>
                      <td>
                        {revealed[s.name] ? (
                          <span className="revealed">
                            <code>{revealed[s.name]}</code>{" "}
                            <button className="linklike" type="button" onClick={() => void copy(revealed[s.name], "Value")}>
                              Copy
                            </button>{" "}
                            <button className="linklike" type="button" onClick={() => hide(s.name)}>
                              Hide
                            </button>
                          </span>
                        ) : (
                          <button className="linklike" type="button" onClick={() => void reveal(s.name)}>
                            Reveal
                          </button>
                        )}
                      </td>
                      <td className="right">
                        <button className="linklike danger" type="button" onClick={() => void removeSecret(s.name)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="foot-note">Reveals are audit-logged. Agents should use proxy calls, never raw values.</p>
          </section>
        )}

        {view === "keys" && (
          <section className="card">
            <form className="key-form" onSubmit={(e) => void createKey(e)}>
              <label>
                Label
                <input value={keyName} onChange={(e) => setKeyName(e.target.value)} />
              </label>
              <label>
                Expires in days
                <input value={keyTtl} onChange={(e) => setKeyTtl(e.target.value)} inputMode="numeric" />
              </label>
              <p className="muted small wide">
                Scoped automatically: blind proxy only (<code>github:create-repo</code>,{" "}
                <code>openai:chat</code>). Scopes lock at creation and can't be widened later.
              </p>
              <label className="wide">
                IP allowlist (optional, comma separated)
                <input value={keyIps} onChange={(e) => setKeyIps(e.target.value)} placeholder="203.0.113.7" />
              </label>
              <button className="btn primary" type="submit">
                Create key
              </button>
            </form>
            {createdToken && (
              <div className="token-once">
                <p>
                  <strong>Copy this token now</strong> — it will never be shown again.
                </p>
                <code>{createdToken.token}</code>
                <div>
                  <button className="btn light" type="button" onClick={() => void copy(createdToken.token, "Token")}>
                    Copy token
                  </button>{" "}
                  <button className="btn light" type="button" onClick={() => setCreatedToken(null)}>
                    Dismiss
                  </button>
                </div>
                <div className="agent-prompt">
                  <p>
                    <strong>Next:</strong> paste this prompt into your repo's <code>AGENTS.md</code> so the
                    agent knows the secrets are here — token included, ready to go.
                  </p>
                  <pre>{agentPromptFor(createdToken.token)}</pre>
                  <div>
                    <button
                      className="btn light"
                      type="button"
                      onClick={() => void copy(agentPromptFor(createdToken.token), "Agent prompt")}
                    >
                      Copy agent prompt
                    </button>
                  </div>
                </div>
              </div>
            )}
            {keys.length === 0 ? (
              <div className="empty">
                <p>No agent keys yet.</p>
                <p className="muted small">Create one for each agent or terminal that needs access.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Prefix</th>
                    <th>Scopes</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id}>
                      <td>{k.name}</td>
                      <td>
                        <code>{k.key_prefix}</code>
                      </td>
                      <td className="muted small">{shortScopes(k.scopes)}</td>
                      <td>{k.revoked_at ? <span className="pill off">revoked</span> : <span className="pill on">active</span>}</td>
                      <td className="right">
                        {!k.revoked_at && (
                          <button className="linklike danger" type="button" onClick={() => void revokeKey(k.id, k.name)}>
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {view === "activity" && (
          <section className="card">
            {audit.length === 0 ? (
              <div className="empty">
                <p>No events yet.</p>
                <p className="muted small">Stores, reveals, proxy calls, and revocations will show up here.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>Action</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.slice(0, 50).map((a, i) => (
                    <tr key={`${a.created_at}-${i}`}>
                      <td className="muted small">{a.created_at?.replace("T", " ").slice(0, 19)}</td>
                      <td>{a.actor}</td>
                      <td>
                        <code>{a.action}</code>
                      </td>
                      <td>{a.ok ? <span className="pill on">ok</span> : <span className="pill off">fail</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="foot-note">Values never appear here.</p>
          </section>
        )}

        {view === "tools" && (
          <section className="card">
            {tools.length === 0 ? (
              <p className="muted">No tools registered.</p>
            ) : (
              <ul className="tool-list">
                {tools.map((t) => (
                  <li key={`${t.provider}/${t.action}`}>
                    <code>
                      {t.provider}/{t.action}
                    </code>
                    <span className="muted small">{t.description}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="foot-note">
              API endpoint: {apiBase} ·{" "}
              <button className="linklike" type="button" onClick={() => switchApi("http://127.0.0.1:8787")}>
                use local
              </button>{" "}
              ·{" "}
              <button className="linklike" type="button" onClick={() => switchApi("https://keyveil-api.parithosh.workers.dev")}>
                use production
              </button>
            </p>
          </section>
        )}

        <footer className="dash-foot">
          <span>KeyVeil runs on Cloudflare Pages, Workers, and D1.</span>
          <a href="https://github.com/Parithosh-Varma/keyveil">GitHub</a>
        </footer>
      </div>
    </div>
  );
}

function viewTitle(view: string): string {
  switch (view) {
    case "keys":
      return "Agent keys";
    case "activity":
      return "Activity";
    case "tools":
      return "Proxy actions";
    default:
      return "API keys";
  }
}

function viewSub(view: string): string {
  switch (view) {
    case "keys":
      return "Tokens are shown once. Only hashes are stored.";
    case "activity":
      return "Who did what, when, from where.";
    case "tools":
      return "What scoped tokens are allowed to call.";
    default:
      return "Encrypted at rest. Names listed, values never.";
  }
}

/** Eased count-up for stat numbers. Jumps straight under reduced motion. */
function useCountUp(target: number): number {
  const [val, setVal] = useState(0);
  const reduce = useRef(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (reduce.current) {
      setVal(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const dur = 650;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return val;
}

function shortScopes(raw: string): string {
  try {
    const arr = JSON.parse(raw) as string[];
    if (arr.includes("*")) return "all";
    return arr.slice(0, 3).join(", ") + (arr.length > 3 ? ` +${arr.length - 3}` : "");
  } catch {
    return raw;
  }
}

/** Mirror of the server's allowlist rule: exact IPv4 or A.B.C.0/24. */
function isValidIpRule(rule: string): boolean {
  const oct = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
  return (
    new RegExp(`^${oct}\\.${oct}\\.${oct}\\.${oct}$`).test(rule) ||
    new RegExp(`^${oct}\\.${oct}\\.${oct}\\.0\\/24$`).test(rule)
  );
}

function agentPromptFor(token: string): string {
  return `# Secrets are here — use KeyVeil, don't ask for keys

This project keeps all API keys in KeyVeil, a blind secrets gateway. When you need
a key (OpenAI, GitHub, …), just notify the user that the secrets are here and spend
them through the proxy — never ask anyone to paste a key into chat.

export VEIL_AGENT_TOKEN=${token}
export API_BASE_URL=${API}

# WARNING: this token is a live credential. Keep it in shell env / .env only —
# never commit it to git, never paste it into a public repo or chat log.

- Discover first: GET /v1/tools — only use tools this user allows
- Spend blind: POST /v1/proxy/<provider>/<action> with JSON args; use the returned result only
- Never echo / cat / printenv secrets; never put secret values in chat, logs, or git
- On 401/403/429 stop and report "veil auth failed / scope denied / IP not allowlisted / rate limited" — don't retry with another key`;
}
