import type { Env } from "./types";
import { TOOLS } from "./types";
import {
  authAgent,
  clearSessionCookie,
  clientIp,
  getBearerSessionId,
  getBearerSessionUser,
  getBearerToken,
  getCookie,
  getSessionUser,
  hasScope,
  json,
  redeemGrant,
  revokeSession,
  sessionBearer,
} from "./lib/auth";
import { encryptSecret, fullAgentToken, newAgentToken, sha256Hex } from "./lib/crypto";
import { audit, loadUserSecret } from "./lib/vault";
import { proxyGithubCreateRepo, proxyOpenAiChat } from "./routes/proxy";
import { googleCallback, googleStart } from "./routes/google";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const res = await handle(req, env);
    return withCors(req, env, res);
  },
};

/** Pages (keyveil.pages.dev) and the Worker are different sites, so every
 *  response must carry CORS headers and allow credentials (session cookie). */
function corsOrigin(req: Request, env: Env): string {
  const origin = req.headers.get("Origin") || "";
  const allowed = [
    env.WEB_BASE_URL,
    env.DASHBOARD_URL,
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://localhost:5174",
  ].filter(Boolean) as string[];
  if (origin && allowed.includes(origin)) return origin;
  return env.WEB_BASE_URL || "";
}

function withCors(req: Request, env: Env, res: Response): Response {
  const h = new Headers(res.headers);
  const origin = corsOrigin(req, env);
  if (origin) h.set("Access-Control-Allow-Origin", origin);
  h.set("Access-Control-Allow-Credentials", "true");
  h.append("Vary", "Origin");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Frame-Options", "DENY");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

async function handle(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
          "Access-Control-Allow-Headers": "Authorization,Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    if (path === "/health" && method === "GET") return json({ ok: true });
    if (path === "/v1/tools" && method === "GET") return json({ tools: TOOLS });
    if (path === "/v1/whoami" && method === "GET") return handleWhoami(req, env);
    if (path === "/v1/auth/google/start" && method === "GET") return googleStart(req, env);
    if (path === "/v1/auth/google/callback" && method === "GET") return googleCallback(req, env);
    if (path === "/v1/auth/logout" && method === "POST") return handleLogout(req, env);
    if (path === "/v1/auth/grant" && method === "POST") return handleGrant(req, env);

    if (path === "/v1/secrets" && method === "POST") return handleStoreSecret(req, env);
    if (path === "/v1/secrets" && method === "GET") return handleListSecrets(req, env);
    const secretByName = path.match(/^\/v1\/secrets\/([A-Z0-9_]{1,64})$/);
    if (secretByName && method === "GET") return handleRevealSecret(req, env, secretByName[1]);
    if (secretByName && method === "DELETE") return handleDeleteSecret(req, env, secretByName[1]);
    if (path === "/v1/agent-keys" && method === "POST") return handleCreateAgentKey(req, env);
    if (path === "/v1/agent-keys" && method === "GET") return handleListAgentKeys(req, env);
    const revokeKey = path.match(/^\/v1\/agent-keys\/([\w-]{1,64})\/revoke$/);
    if (revokeKey && method === "POST") return handleRevokeAgentKey(req, env, revokeKey[1]);
    if (path === "/v1/audit" && method === "GET") return handleAudit(req, env);

    const m = path.match(/^\/v1\/proxy\/([\w-]+)\/([\w-]+)$/);
    if (m && method === "POST") return handleProxy(req, env, m[1], m[2]);

    return json({ error: "not found", path }, 404);
}

// --- auth resolution -------------------------------------------------------
// Human session acts with full rights on its own account. Bearer agent keys
// act on their owner's account but need explicit scopes for sensitive routes:
//   secrets:reveal  read raw secret values (terminal use — audited)
//   keys:manage      create/list/revoke agent keys
//   audit:read       read the audit log

interface Actor {
  userId: string;
  via: "human" | "agent";
  scopes: string[];
  keyPrefix?: string;
  keyName?: string;
}

async function resolveUser(req: Request, env: Env): Promise<Actor | Response> {
  const sessionUid = await getSessionUser(req, env);
  if (sessionUid) return { userId: sessionUid, via: "human", scopes: ["*"] };
  // Cookie-less session transport for cross-site frontends (localStorage).
  const bearerSessionUid = await getBearerSessionUser(req, env);
  if (bearerSessionUid) return { userId: bearerSessionUid, via: "human", scopes: ["*"] };
  if (getBearerToken(req)) {
    const authed = await authAgent(req, env);
    if (authed instanceof Response) return authed;
    return {
      userId: authed.row.user_id,
      via: "agent",
      scopes: authed.scopes,
      keyPrefix: authed.row.key_prefix,
      keyName: authed.row.name,
    };
  }
  return json({ error: "login required" }, 401);
}

/** Humans bypass scope checks; agents need the explicit scope. */
function needScope(actor: Actor, scope: string): Response | null {
  if (actor.via === "human") return null;
  if (hasScope(actor.scopes, scope)) return null;
  return json({ error: "scope denied", need: scope }, 403);
}

async function handleWhoami(req: Request, env: Env): Promise<Response> {
  const actorOr = await resolveUser(req, env);
  if (actorOr instanceof Response) return actorOr;
  let name: string | null = null;
  let picture: string | null = null;
  if (env.DB) {
    const row = await env.DB.prepare("SELECT name, picture FROM users WHERE id = ? LIMIT 1")
      .bind(actorOr.userId)
      .first<{ name: string | null; picture: string | null }>()
      .catch(() => null);
    name = row?.name || null;
    picture = row?.picture || null;
  }
  return json({
    user_id: actorOr.userId,
    via: actorOr.via,
    scopes: actorOr.scopes,
    name,
    picture,
    key_prefix: actorOr.keyPrefix || null,
    key_name: actorOr.keyName || null,
  });
}

async function handleGrant(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const sessionId = await redeemGrant(env, body.code || "");
  if (!sessionId) return json({ error: "invalid or expired grant" }, 401);
  return json({ session_token: sessionBearer(sessionId) });
}

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const id = getCookie(req, "session") || getBearerSessionId(req);
  if (id) await revokeSession(env, id);
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

async function handleStoreSecret(req: Request, env: Env): Promise<Response> {
  const actorOr = await resolveUser(req, env);
  if (actorOr instanceof Response) return actorOr;
  const actor = actorOr;
  const body = (await req.json().catch(() => ({}))) as { name?: string; value?: string };
  const name = (body.name || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 64);
  const value = body.value || "";
  if (!name || value.length < 3 || value.length > 20000) return json({ error: "bad name/value" }, 400);
  const ct = await encryptSecret(env, value);
  try {
    if (env.VEIL_KV) await env.VEIL_KV.put(`u:${actor.userId}:s:${name}`, ct);
    if (env.DB) {
      await env.DB.prepare(
        "INSERT INTO secrets (id, user_id, name, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET ciphertext=excluded.ciphertext, updated_at=excluded.updated_at"
      )
        .bind(crypto.randomUUID(), actor.userId, name, ct, new Date().toISOString())
        .run();
    }
  } catch (e) {
    return json({ error: "store failed" }, 500);
  }
  await audit(env, { user_id: actor.userId, actor: actor.via, action: "secret:store", provider: name, ok: true, ip: clientIp(req) });
  return json({ ok: true, name });
}

async function handleListSecrets(req: Request, env: Env): Promise<Response> {
  const actorOr = await resolveUser(req, env);
  if (actorOr instanceof Response) return actorOr;
  // Metadata only — never return values.
  if (!env.DB) return json({ secrets: [] });
  const rows = await env.DB.prepare("SELECT name, updated_at FROM secrets WHERE user_id = ? ORDER BY name")
    .bind(actorOr.userId)
    .all<{ name: string; updated_at: string }>()
    .catch(() => ({ results: [] as { name: string; updated_at: string }[] }));
  return json({ secrets: rows.results });
}

async function handleRevealSecret(req: Request, env: Env, name: string): Promise<Response> {
  const actorOr = await resolveUser(req, env);
  if (actorOr instanceof Response) return actorOr;
  const actor = actorOr;
  const denied = needScope(actor, "secrets:reveal");
  if (denied) {
    await audit(env, { user_id: actor.userId, actor: actor.via, provider: name, action: "secret:reveal:denied-scope", ok: false, ip: clientIp(req) });
    return denied;
  }
  const value = await loadUserSecret(env, actor.userId, name);
  if (value === null) {
    await audit(env, { user_id: actor.userId, actor: actor.via, provider: name, action: "secret:reveal:missing", ok: false, ip: clientIp(req) });
    return json({ error: "no such secret" }, 404);
  }
  await audit(env, { user_id: actor.userId, actor: actor.via, provider: name, action: "secret:reveal", ok: true, ip: clientIp(req) });
  return json({ name, value });
}

async function handleDeleteSecret(req: Request, env: Env, name: string): Promise<Response> {
  const actorOr = await resolveUser(req, env);
  if (actorOr instanceof Response) return actorOr;
  const actor = actorOr;
  try {
    if (env.VEIL_KV) await env.VEIL_KV.delete(`u:${actor.userId}:s:${name}`);
    if (env.DB) {
      await env.DB.prepare("DELETE FROM secrets WHERE user_id = ? AND name = ?")
        .bind(actor.userId, name)
        .run();
    }
  } catch {
    return json({ error: "delete failed" }, 500);
  }
  await audit(env, { user_id: actor.userId, actor: actor.via, action: "secret:delete", provider: name, ok: true, ip: clientIp(req) });
  return json({ ok: true, name });
}

async function handleCreateAgentKey(req: Request, env: Env): Promise<Response> {
  const actorOr = await resolveUser(req, env);
  if (actorOr instanceof Response) return actorOr;
  const actor = actorOr;
  const denied = needScope(actor, "keys:manage");
  if (denied) {
    await audit(env, { user_id: actor.userId, actor: actor.via, action: "agent-key:create:denied-scope", ok: false, ip: clientIp(req) });
    return denied;
  }
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
  const keyId = crypto.randomUUID();
  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO agent_keys (id, user_id, name, key_hash, key_prefix, scopes, ip_allowlist, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        keyId,
        actor.userId,
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
  await audit(env, { user_id: actor.userId, actor: actor.via, action: "agent-key:create", ok: true, ip: clientIp(req) });
  // Show full token ONCE. UI must tell user to save it in $VEIL_AGENT_TOKEN.
  return json({ id: keyId, token: fullAgentToken(prefix, secret), prefix, scopes, expires_at: expires });
}

async function handleListAgentKeys(req: Request, env: Env): Promise<Response> {
  const actorOr = await resolveUser(req, env);
  if (actorOr instanceof Response) return actorOr;
  const actor = actorOr;
  const denied = needScope(actor, "keys:manage");
  if (denied) return denied;
  // Metadata only — hashes and secrets never leave the server.
  if (!env.DB) return json({ keys: [] });
  const rows = await env.DB.prepare(
    "SELECT id, name, key_prefix, scopes, ip_allowlist, expires_at, revoked_at, created_at FROM agent_keys WHERE user_id = ? ORDER BY created_at DESC"
  )
    .bind(actor.userId)
    .all()
    .catch(() => ({ results: [] }));
  return json({ keys: rows.results });
}

async function handleRevokeAgentKey(req: Request, env: Env, id: string): Promise<Response> {
  const actorOr = await resolveUser(req, env);
  if (actorOr instanceof Response) return actorOr;
  const actor = actorOr;
  const denied = needScope(actor, "keys:manage");
  if (denied) return denied;
  if (env.DB) {
    await env.DB.prepare("UPDATE agent_keys SET revoked_at = ? WHERE id = ? AND user_id = ?")
      .bind(new Date().toISOString(), id, actor.userId)
      .run()
      .catch(() => {});
  }
  await audit(env, { user_id: actor.userId, actor: actor.via, action: "agent-key:revoke", ok: true, ip: clientIp(req) });
  return json({ ok: true, id });
}

async function handleAudit(req: Request, env: Env): Promise<Response> {
  const actorOr = await resolveUser(req, env);
  if (actorOr instanceof Response) return actorOr;
  const actor = actorOr;
  const denied = needScope(actor, "audit:read");
  if (denied) return denied;
  if (!env.DB) return json({ audit: [] });
  const rows = await env.DB.prepare(
    "SELECT actor, provider, action, ok, ip, created_at FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
  )
    .bind(actor.userId)
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
