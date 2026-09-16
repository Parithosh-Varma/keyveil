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
