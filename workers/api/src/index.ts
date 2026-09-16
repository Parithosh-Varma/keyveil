import type { Env } from "./types";
import { TOOLS } from "./types";
import { authAgent, clientIp, getBearerToken, hasScope, json } from "./lib/auth";
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

    if (path === "/v1/secrets" && method === "POST") return handleStoreSecret(req, env);
    if (path === "/v1/secrets" && method === "GET") return handleListSecrets(req, env);
    if (path === "/v1/agent-keys" && method === "POST") return handleCreateAgentKey(req, env);
    if (path === "/v1/audit" && method === "GET") return handleAudit(req, env);

    const m = path.match(/^\/v1\/proxy\/([\w-]+)\/([\w-]+)$/);
    if (m && method === "POST") return handleProxy(req, env, m[1], m[2]);

    return json({ error: "not found", path }, 404);
  },
};

async function sessionUserId(req: Request, env: Env): Promise<string | null> {
  const cookie = req.headers.get("Cookie") || "";
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  if (!m) return null;
  const [userId, sig] = decodeURIComponent(m[1]).split(".");
  if (!userId || !sig) return null;
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${userId}.${env.SESSION_SECRET}`));
  const expect = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  return sig === expect ? userId : null;
}

async function humanOr401(req: Request, env: Env): Promise<string | Response> {
  const uid = await sessionUserId(req, env);
  if (!uid) return json({ error: "login required" }, 401);
  return uid;
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
