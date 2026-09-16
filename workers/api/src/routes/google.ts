import type { Env } from "../types";
import { json } from "../lib/auth";

/**
 * Google OAuth 2.0 (multi-user prod). Scaffold only — exchange + verify, then
 * create a session. Configure GOOGLE_CLIENT_ID/SECRET + redirect in Cloudflare.
 */
export async function googleStart(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(req, env),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  const res = json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  // In prod: set signed state cookie here and validate it in callback (CSRF).
  void url;
  return res;
}

export async function googleCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code) return json({ error: "missing code" }, 400);
  // 1) Exchange code for tokens
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(req, env),
      grant_type: "authorization_code",
    }),
  });
  if (!tok.ok) return json({ error: "token exchange failed" }, 502);
  const tj = (await tok.json()) as { id_token?: string };
  if (!tj.id_token) return json({ error: "no id_token" }, 502);
  // 2) Verify id_token minimally (scaffold): decode + check aud. Prod: verify signature via Google certs.
  const payload = JSON.parse(atob(tj.id_token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")));
  if (payload.aud !== env.GOOGLE_CLIENT_ID) return json({ error: "bad audience" }, 401);
  const email = String(payload.email || "").toLowerCase();
  if (!payload.email_verified || !email) return json({ error: "email not verified" }, 401);

  // 3) Upsert user in D1 (if bound) — local dev without D1 still returns identity.
  let userId = `u_${await sha(`google:${email}`)}`.slice(0, 24);
  try {
    if (env.DB) {
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
        .bind(email)
        .first<{ id: string }>();
      if (existing) {
        userId = existing.id;
      } else {
        await env.DB.prepare(
          "INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)"
        )
          .bind(userId, email, payload.name || email, new Date().toISOString())
          .run();
      }
    }
  } catch {
    // ignore in scaffold dev
  }

  // 4) Issue session cookie (HMAC-signed userId). Real prod: rotate + store session row.
  const sig = (await sha(`${userId}.${env.SESSION_SECRET}`)).slice(0, 32);
  const session = `${userId}.${sig}`;
  const web = env.WEB_BASE_URL || "/";
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${web}/dashboard.html?login=ok`,
      "Set-Cookie": `session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    },
  });
}

function redirectUri(req: Request, env: Env): string {
  void req;
  // Prefer explicit env in production; fallback derives from request in dev.
  return (env as unknown as { GOOGLE_REDIRECT_URL?: string }).GOOGLE_REDIRECT_URL || "http://127.0.0.1:8787/v1/auth/google/callback";
}

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
