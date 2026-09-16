import { sha256Hex } from "./crypto";
import type { AgentKeyRow, Env } from "../types";

export function getBearerToken(req: Request): string | null {
  const h = req.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function clientIp(req: Request): string {
  // Trust Cloudflare's verified client IP only. X-Forwarded-For is
  // attacker-controlled on direct workers.dev hits and must never override
  // it (audit-log poisoning / IP-allowlist bypass).
  return req.headers.get("CF-Connecting-IP") || "unknown";
}

/** IP allowlist: exact IPv4 match or A.B.C.0/24 prefix. Fail-closed. */
export function ipAllowed(ip: string, allowlist: string[] | null): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  for (const rule of allowlist) {
    if (rule === ip) return true;
    if (rule.endsWith(".0/24")) {
      // e.g. 203.0.113.0/24 matches 203.0.113.*
      const base = rule.replace(".0/24", ".");
      if (ip.startsWith(base)) return true;
    }
  }
  return false;
}

export async function authAgent(req: Request, env: Env): Promise<{ row: AgentKeyRow; scopes: string[] } | Response> {
  const token = getBearerToken(req);
  if (!token) return json({ error: "missing bearer token" }, 401);
  const dot = token.lastIndexOf(".");
  if (dot < 0) return json({ error: "malformed token" }, 401);
  const prefix = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  const hash = await sha256Hex(secret);

  if (!env.DB) return json({ error: "DB not bound" }, 500);
  const row = await env.DB.prepare(
    "SELECT * FROM agent_keys WHERE key_prefix = ? AND key_hash = ? LIMIT 1"
  )
    .bind(prefix, hash)
    .first<AgentKeyRow>();
  if (!row || row.revoked_at) return json({ error: "invalid token" }, 401);
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return json({ error: "token expired" }, 401);
  }
  let allowlist: string[] | null = null;
  try {
    allowlist = row.ip_allowlist ? (JSON.parse(row.ip_allowlist) as string[]) : null;
  } catch {
    allowlist = null;
  }
  if (!ipAllowed(clientIp(req), allowlist)) return json({ error: "ip not allowlisted" }, 403);
  let scopes: string[] = [];
  try {
    scopes = JSON.parse(row.scopes) as string[];
  } catch {
    scopes = [];
  }
  return { row, scopes };
}

export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  // This API serves secrets, session grants, and key metadata: nothing it
  // returns may sit in a browser disk cache, back-button cache entry, or
  // edge cache. Callers needing to cache /v1/tools can opt out per-route.
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      pragma: "no-cache",
      ...(extra || {}),
    },
  });
}

export function hasScope(scopes: string[], need: string): boolean {
  return scopes.includes("*") || scopes.includes(need);
}

/**
 * Consume one use of an agent key, atomically. Returns true if a use was
 * available. NULL max_uses = unlimited. The single UPDATE statement makes
 * concurrent spends race-safe: only one wins the last use.
 */
export async function consumeUse(env: Env, keyId: string): Promise<boolean> {
  if (!env.DB) return false;
  try {
    const res = await env.DB.prepare(
      "UPDATE agent_keys SET uses = uses + 1 WHERE id = ? AND (max_uses IS NULL OR uses < max_uses)"
    )
      .bind(keyId)
      .run();
    return (res.meta?.changes ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Opaque 256-bit random token, base64url-encoded. */
export function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function getCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("Cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/** Create an opaque server-side session, returns the session id for the cookie. */
export async function createSession(env: Env, userId: string, days = 7): Promise<string> {
  if (!env.DB) throw new Error("DB not bound");
  const id = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"
  )
    .bind(id, userId, new Date(now).toISOString(), new Date(now + days * 864e5).toISOString())
    .run();
  return id;
}

/** Resolve a session id to a user id, or null. */
export async function getSessionById(env: Env, id: string): Promise<string | null> {
  if (!id || !/^[\w-]{20,}$/.test(id) || !env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT user_id, expires_at, revoked_at FROM sessions WHERE id = ? LIMIT 1"
  )
    .bind(id)
    .first<{ user_id: string; expires_at: string; revoked_at: string | null }>()
    .catch(() => null);
  if (!row || row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return row.user_id;
}

/** Resolve the session cookie to a user id, or null. */
export async function getSessionUser(req: Request, env: Env): Promise<string | null> {
  return getSessionById(env, getCookie(req, "session") || "");
}

/** Session bearer transport: `Authorization: Bearer sess_<id>`.
 *  Same opaque session as the cookie — for frontends where third-party
 *  cookies are blocked. Never log or return the id itself. */
export function sessionBearer(id: string): string {
  return `sess_${id}`;
}

export async function getBearerSessionUser(req: Request, env: Env): Promise<string | null> {
  const t = getBearerToken(req);
  if (!t || !t.startsWith("sess_")) return null;
  return getSessionById(env, t.slice(5));
}

export function getBearerSessionId(req: Request): string | null {
  const t = getBearerToken(req);
  if (!t || !t.startsWith("sess_")) return null;
  const id = t.slice(5);
  return /^[\w-]{20,}$/.test(id) ? id : null;
}

/** One-time login grant: exchanged for a session within 5 minutes. */export async function createGrant(env: Env, userId: string): Promise<string> {
  if (!env.DB) throw new Error("DB not bound");
  const code = randomToken();
  const now = Date.now();
  await env.DB.prepare("INSERT INTO grants (code, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(code, userId, new Date(now).toISOString(), new Date(now + 5 * 60_000).toISOString())
    .run();
  return code;
}

/** Redeem a grant code for a fresh session id. Single-use. */
export async function redeemGrant(env: Env, code: string): Promise<string | null> {
  if (!code || !/^[\w-]{20,}$/.test(code) || !env.DB) return null;
  const row = await env.DB.prepare("SELECT user_id, expires_at, used_at FROM grants WHERE code = ? LIMIT 1")
    .bind(code)
    .first<{ user_id: string; expires_at: string; used_at: string | null }>()
    .catch(() => null);
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  await env.DB.prepare("UPDATE grants SET used_at = ? WHERE code = ?")
    .bind(new Date().toISOString(), code)
    .run()
    .catch(() => null);
  try {
    return await createSession(env, row.user_id);
  } catch {
    return null;
  }
}

export async function revokeSession(env: Env, id: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run()
    .catch(() => {});
}

// SameSite=None + Secure + Partitioned: Pages and the Worker are different
// sites. Partitioned (CHIPS) keeps the cookie working where third-party
// cookies are blocked; where even that fails, the login grant flow hands the
// frontend a session bearer instead (see grants below).
export function sessionCookie(id: string): string {
  return `session=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=604800`;
}

export function clearSessionCookie(): string {
  return `session=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0`;
}

/** Server-side OAuth state (cookie-less CSRF protection).
 *  The dashboard generates a random state, the worker records it at /start,
 *  Google echoes it to /callback, and the worker consumes it exactly once.
 *  The dashboard additionally echo-checks it, so a state an attacker
 *  initiated can never complete inside the victim's tab. */
export function validClientState(s: string): boolean {
  return /^[\w-]{20,64}$/.test(s);
}

export async function storeLoginState(env: Env, state: string): Promise<void> {
  if (!env.DB) return;
  const now = Date.now();
  await env.DB.prepare("INSERT INTO oauth_states (state, created_at, expires_at) VALUES (?, ?, ?)")
    .bind(state, new Date(now).toISOString(), new Date(now + 10 * 60_000).toISOString())
    .run()
    .catch(() => null);
  // Opportunistic expiry sweep.
  await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?")
    .bind(new Date(now).toISOString())
    .run()
    .catch(() => null);
}

/** Returns true once per state; false when unknown, expired, or reused. */
export async function consumeLoginState(env: Env, state: string): Promise<boolean> {
  if (!env.DB || !validClientState(state)) return false;
  const row = await env.DB.prepare("SELECT expires_at FROM oauth_states WHERE state = ? LIMIT 1")
    .bind(state)
    .first<{ expires_at: string }>()
    .catch(() => null);
  if (!row) return false;
  await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run().catch(() => null);
  return new Date(row.expires_at).getTime() >= Date.now();
}
