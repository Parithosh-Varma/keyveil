import type { Env } from "./types";
import { TOOLS } from "./types";
import {
  authAgent,
  clearSessionCookie,
  clientIp,
  getBearerToken,
  getCookie,
  getSessionUser,
  hasScope,
  json,
  revokeSession,
} from "./lib/auth";
import { encryptSecret, fullAgentToken, newAgentToken, sha256Hex } from "./lib/crypto";
import { audit } from "./lib/vault";
import { proxyGithubCreateRepo, proxyOpenAiChat } from "./routes/proxy";
import { googleCallback, googleStart } from "./routes/google";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    // CORS for Pages UI (lock down Access-Control-Allow-Origin in prod)
    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": env.WEB_BASE_URL || "*",
          "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Authorization,Content-Type",
        },
      });
    }

    if (path === "/health" && method === "GET") return json({ ok: true });
    if (path === "/v1/tools" && method === "GET") return json({ tools: TOOLS });
    if (path === "/v1/auth/google/start" && method === "GET") return googleStart(req, env);
    if (path === "/v1/auth/google/callback" && method === "GET") return googleCallback(req, env);
    if (path === "/v1/auth/logout" && method === "POST") return handleLogout(req, env);

    if (path === "/v1/secrets" && method === "POST") return handleStoreSecret(req, env);
    if (path === "/v1/secrets" && method === "GET") return handleListSecrets(req, env);
    const delSecret = path.match(/^\/v1\/secrets\/([A-Z0-9_]{1,64})$/);
    if (delSecret && method === "DELETE") return handleDeleteSecret(req, env, delSecret[1]);
    if (path === "/v1/agent-keys" && method === "POST") return handleCreateAgentKey(req, env);
    if (path === "/v1/agent-keys" && method === "GET") return handleListAgentKeys(req, env);
    const revokeKey = path.match(/^\/v1\/agent-keys\/([\w-]{1,64})\/revoke$/);
    if (revokeKey && method === "POST") return handleRevokeAgentKey(req, env, revokeKey[1]);
    if (path === "/v1/audit" && method === "GET") return handleAudit(req, env);

    const m = path.match(/^\/v1\/proxy\/([\w-]+)\/([\w-]+)$/);
    if (m && method === "POST") return handleProxy(req, env, m[1], m[2]);

    return json({ error: "not found", path }, 404);
  },
};

async function humanOr401(req: Request, env: Env): Promise<string | Response> {
  const uid = await getSessionUser(req, env);
  if (!uid) return json({ error: "login required" }, 401);
  return uid;
}

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const id = getCookie(req, "session");
  if (id) await revokeSession(env, id);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

async function handleStoreSecret(req: Request, env: Env): Promise<Response> {
  const uidOr = await humanOr401(req, env);
  if (typeof uidOr !== "string") return uidOr;
  const body = (await req.json().catch(() => ({}))) as { name?: string; value?: string };
  const name = (body.name || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 64);
  const value = body.value || "";
  if (!name || value.length < 3 || value.length > 20000) return json({ error: "bad name/value" }, 400);
  const ct = await encryptSecret(env, value);
  try {
    if (env.VEIL_KV) await env.VEIL_KV.put(`u:${uidOr}:s:${name}`, ct);
    if (env.DB) {
      await env.DB.prepare(
        "INSERT INTO secrets (id, user_id, name, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET ciphertext=excluded.ciphertext, updated_at=excluded.updated_at"
      )
        .bind(crypto.randomUUID(), uidOr, name, ct, new Date().toISOString())
        .run();
    }
  } catch (e) {
    return json({ error: "store failed" }, 500);
  }
  await audit(env, { user_id: uidOr, actor: "human", action: "secret:store", provider: name, ok: true, ip: clientIp(req) });
  return json({ ok: true, name });
}

async function handleListSecrets(req: Request, env: Env): Promise<Response> {
  const uidOr = await humanOr401(req, env);
  if (typeof uidOr !== "string") return uidOr;
  // Metadata only — never return values.
  if (!env.DB) return json({ secrets: [] });
  const rows = await env.DB.prepare("SELECT name, updated_at FROM secrets WHERE user_id = ? ORDER BY name")
    .bind(uidOr)
    .all<{ name: string; updated_at: string }>()
    .catch(() => ({ results: [] as { name: string; updated_at: string }[] }));
  return json({ secrets: rows.results });
}

async function handleDeleteSecret(req: Request, env: Env, name: string): Promise<Response> {
  const uidOr = await humanOr401(req, env);
  if (typeof uidOr !== "string") return uidOr;
  try {
    if (env.VEIL_KV) await env.VEIL_KV.delete(`u:${uidOr}:s:${name}`);
    if (env.DB) {
      await env.DB.prepare("DELETE FROM secrets WHERE user_id = ? AND name = ?")
        .bind(uidOr, name)
        .run();
    }
  } catch {
    return json({ error: "delete failed" }, 500);
  }
  await audit(env, { user_id: uidOr, actor: "human", action: "secret:delete", provider: name, ok: true, ip: clientIp(req) });
  return json({ ok: true, name });
}

async function handleCreateAgentKey(req: Request, env: Env): Promise<Response> {
  const uidOr = await humanOr401(req, env);
  if (typeof uidOr !== "string") return uidOr;
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    scopes?: string[];
    ip_allowlist?: string[];
    ttl_days?: number;
  };
  const { publicId: _p, secret, prefix } = newAgentToken();
  void _p;
  const hash = await sha256Hex(secret);
  const scopes = Array.isArray(body.scopes) && body.scopes.length ? body.scopes.slice(0, 20) : ["github:create-repo"];
  const expires = body.ttl_days ? new Date(Date.now() + body.ttl_days * 864e5).toISOString() : null;
  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO agent_keys (id, user_id, name, key_hash, key_prefix, scopes, ip_allowlist, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        crypto.randomUUID(),
        uidOr,
        (body.name || "opencode").slice(0, 64),
        hash,
        prefix,
        JSON.stringify(scopes),
        JSON.stringify(body.ip_allowlist || []),
        expires,
        new Date().toISOString()
      )
      .run()
      .catch(() => {});
  }
  await audit(env, { user_id: uidOr, actor: "human", action: "agent-key:create", ok: true, ip: clientIp(req) });
  // Show full token ONCE. UI must tell user to save it in $VEIL_AGENT_TOKEN.
  return json({ token: fullAgentToken(prefix, secret), prefix, scopes, expires_at: expires });
}

async function handleListAgentKeys(req: Request, env: Env): Promise<Response> {
  const uidOr = await humanOr401(req, env);
  if (typeof uidOr !== "string") return uidOr;
  // Metadata only — hashes and secrets never leave the server.
  if (!env.DB) return json({ keys: [] });
  const rows = await env.DB.prepare(
    "SELECT id, name, key_prefix, scopes, ip_allowlist, expires_at, revoked_at, created_at FROM agent_keys WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(uidOr)
    .all()
    .catch(() => ({ results: [] }));
  return json({ keys: rows.results });
}

async function handleRevokeAgentKey(req: Request, env: Env, id: string): Promise<Response> {
  const uidOr = await humanOr401(req, env);
  if (typeof uidOr !== "string") return uidOr;
  if (env.DB) {
    await env.DB.prepare("UPDATE agent_keys SET revoked_at = ? WHERE id = ? AND user_id = ?")
      .bind(new Date().toISOString(), id, uidOr)
      .run()
      .catch(() => {});
  }
  await audit(env, { user_id: uidOr, actor: "human", action: "agent-key:revoke", ok: true, ip: clientIp(req) });
  return json({ ok: true, id });
}

async function handleAudit(req: Request, env: Env): Promise<Response> {
  const uidOr = await humanOr401(req, env);
  if (typeof uidOr !== "string") return uidOr;
  if (!env.DB) return json({ audit: [] });
  const rows = await env.DB.prepare(
    "SELECT actor, provider, action, ok, ip, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
  )
    .bind(uidOr)
    .all()
    .catch(() => ({ results: [] }));
  return json({ audit: rows.results });
}

async function handleProxy(req: Request, env: Env, provider: string, action: string): Promise<Response> {
  const bearer = getBearerToken(req);
  if (!bearer) return json({ error: "missing bearer" }, 401);
  const authed = await authAgent(req, env);
  if (authed instanceof Response) return authed;
  // Best-effort per-key rate limit (60/min). In-memory per isolate — also add a
  // Cloudflare Rate Limiting Rule on /v1/proxy/* for edge-wide enforcement.
  if (proxyRateLimited(`agent:${authed.row.key_prefix}`)) {
    await audit(env, { user_id: authed.row.user_id, actor: "agent", provider, action: `${action}:rate-limited`, ok: false, ip: clientIp(req) });
    return json({ error: "rate limited" }, 429, { "Retry-After": "60" });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, never>;
  const need = `${provider}:${action}`;
  const wildcard = `${provider}:*`;
  if (!hasScope(authed.scopes, need) && !hasScope(authed.scopes, wildcard) && !hasScope(authed.scopes, "*")) {
    await audit(env, { user_id: authed.row.user_id, actor: "agent", provider, action: `${action}:denied-scope`, ok: false, ip: clientIp(req) });
    return json({ error: "scope denied", need }, 403);
  }
  if (provider === "github" && action === "create-repo") {
    return proxyGithubCreateRepo(req, env, authed.row.user_id, body as { name?: string; isPublic?: boolean });
  }
  if (provider === "openai" && action === "chat") {
    return proxyOpenAiChat(req, env, authed.row.user_id, body as { model?: string; input?: string });
  }
  return json({ error: "unknown tool", tools: TOOLS }, 404);
}

const proxyHits = new Map<string, number[]>();

function proxyRateLimited(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  const hits = (proxyHits.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  proxyHits.set(key, hits);
  if (proxyHits.size > 5000) {
    const oldest = proxyHits.keys().next().value;
    if (oldest) proxyHits.delete(oldest);
  }
  return hits.length > limit;
}
