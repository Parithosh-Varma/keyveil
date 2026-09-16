import { sha256Hex } from "./crypto";
import type { AgentKeyRow, Env } from "../types";

export function getBearerToken(req: Request): string | null {
  const h = req.headers.get("Authorization");
  if (!h || !h.startsWith("Bearer ")) return null;
  return h.slice(7).trim() || null;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get("CF-Connecting-IP") ||
    req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/** Very small IP allowlist check: exact match or /24,/16 prefix match. Keep simple for scaffold. */
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
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...(extra || {}) },
  });
}

export function hasScope(scopes: string[], need: string): boolean {
  return scopes.includes("*") || scopes.includes(need);
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
export async function createSession(env: Env, userId: string, days = 30): Promise<string> {
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

/** Resolve the session cookie to a user id, or null. */
export async function getSessionUser(req: Request, env: Env): Promise<string | null> {
  const id = getCookie(req, "session");
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

export async function revokeSession(env: Env, id: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id)
    .run()
    .catch(() => {});
}

// SameSite=None + Secure: Pages and the Worker are different sites, so the
// session cookie must be sent on cross-site credentialed fetch. CSRF exposure
// is limited: state-changing agent routes need a Bearer token, human routes
// are gated by the Google OAuth state check + session.
export function sessionCookie(id: string): string {
  return `session=${encodeURIComponent(id)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=2592000`;
}

export function clearSessionCookie(): string {
  return `session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0`;
}
