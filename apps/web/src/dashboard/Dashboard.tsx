import { useCallback, useEffect, useState } from "react";
import { API, api, cleanName, describeApiError, setApiBase } from "../lib/kv";

interface SecretRow {
  name: string;
  updated_at: string;
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

export function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [apiBase, setApiBaseUi] = useState(API);
  const [banner, setBanner] = useState<{ kind: "err" | "ok"; text: string } | null>(null);

  const [secrets, setSecrets] = useState<SecretRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [keyName, setKeyName] = useState("opencode");
  const [keyScopes, setKeyScopes] = useState("github:create-repo,openai:chat");
  const [keyTtl, setKeyTtl] = useState("90");
  const [keyIps, setKeyIps] = useState("");
  const [createdToken, setCreatedToken] = useState<{ id: string; prefix: string; token: string } | null>(null);

  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [tools, setTools] = useState<ToolRow[]>([]);

  function note(kind: "err" | "ok", text: string) {
    setBanner({ kind, text });
  }

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user_id: string }>("/v1/whoami");
      setUserId(me.user_id);
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
      setUserId(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("login") === "ok") {
      history.replaceState(null, "", location.pathname);
      note("ok", "Signed in with Google.");
    }
    void refresh();
  }, [refresh]);

  async function login() {
    try {
      const r = await api<{ url: string }>("/v1/auth/google/start");
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
    setUserId(null);
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
    } catch (e) {
      note("err", describeApiError(e, "Reveal"));
    }
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
    const scopes = keyScopes.split(",").map((s) => s.trim()).filter(Boolean);
    if (!scopes.length) return note("err", "Give the key at least one scope.");
    const ips = keyIps.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      const r = await api<{ id: string; prefix: string; token: string; scopes: string[] }>("/v1/agent-keys", {
        method: "POST",
        body: { name: keyName.trim() || "terminal", scopes, ttl_days: Number(keyTtl) || 90, ip_allowlist: ips },
      });
      setCreatedToken({ id: r.id, prefix: r.prefix, token: r.token });
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
    setApiBaseUi(setApiBase(url));
    setUserId(null);
    setChecking(true);
    void refresh();
  }

  if (checking) {
    return (
      <div className="dash">
        <p className="muted">Checking session…</p>
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="dash">
        <header className="dash-nav">
          <a className="wordmark" href="./">
            keyveil
          </a>
        </header>
        <main className="signin-card">
          <h1>Sign in to manage your keys</h1>
          <p>KeyVeil uses your Google account. No passwords to store, sessions stay on the server.</p>
          <button className="btn primary" type="button" onClick={() => void login()}>
            Continue with Google
          </button>
          {banner && <p className={banner.kind === "err" ? "err" : "ok"}>{banner.text}</p>}
          <p className="muted small">
            API endpoint: {apiBase} ·{" "}
            <button className="linklike" type="button" onClick={() => switchApi("http://127.0.0.1:8787")}>
              use local
            </button>
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="dash">
      <header className="dash-nav">
        <a className="wordmark" href="./">
          keyveil
        </a>
        <div className="dash-user">
          <span className="muted small">{userId}</span>
          <button className="btn" type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      {banner && (
        <p className={`banner ${banner.kind}`} role="status">
          {banner.text}
        </p>
      )}

      <main className="dash-grid">
        <section className="card">
          <div className="card-head">
            <h2>API keys</h2>
            <span className="muted small">{secrets.length} stored · values never listed</span>
          </div>
          <form className="row-form" onSubmit={(e) => void addSecret(e)}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="NAME_LIKE_THIS" aria-label="Secret name" />
            <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="Value (hidden from logs)" type="password" aria-label="Secret value" />
            <button className="btn primary" type="submit">
              Store
            </button>
          </form>
          {secrets.length === 0 ? (
            <p className="muted">No keys yet. Store your first one above.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
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
                    <td className="muted small">{s.updated_at?.slice(0, 10) || "—"}</td>
                    <td>
                      {revealed[s.name] ? (
                        <span className="revealed">
                          <code>{revealed[s.name]}</code>{" "}
                          <button className="linklike" type="button" onClick={() => void copy(revealed[s.name], "Value")}>
                            Copy
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
          <p className="muted small">Reveals are audit-logged. Agents should use proxy calls, never raw values.</p>
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Agent keys</h2>
            <span className="muted small">tokens shown once · hashes stored</span>
          </div>
          <form className="key-form" onSubmit={(e) => void createKey(e)}>
            <label>
              Label
              <input value={keyName} onChange={(e) => setKeyName(e.target.value)} />
            </label>
            <label>
              Scopes (comma separated)
              <input value={keyScopes} onChange={(e) => setKeyScopes(e.target.value)} />
            </label>
            <label>
              Expires in days
              <input value={keyTtl} onChange={(e) => setKeyTtl(e.target.value)} inputMode="numeric" />
            </label>
            <label>
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
                <button className="btn" type="button" onClick={() => void copy(createdToken.token, "Token")}>
                  Copy token
                </button>
              </div>
            </div>
          )}
          {keys.length === 0 ? (
            <p className="muted">No agent keys yet.</p>
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

        <section className="card">
          <div className="card-head">
            <h2>Recent activity</h2>
            <span className="muted small">values never appear here</span>
          </div>
          {audit.length === 0 ? (
            <p className="muted">No events yet.</p>
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
                {audit.slice(0, 20).map((a, i) => (
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
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Available proxy actions</h2>
          </div>
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
          <p className="muted small">
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
      </main>

      <footer className="dash-foot">
        <span>KeyVeil runs on Cloudflare Pages, Workers, and D1.</span>
        <a href="https://github.com/Parithosh-Varma/keyveil">GitHub</a>
      </footer>
    </div>
  );
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
