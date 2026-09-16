import type { Env } from "../types";
import { createGrant, createSession, getCookie, json, randomToken, sessionCookie, storeLoginState, consumeLoginState, validClientState } from "../lib/auth";

/**
 * Google OAuth 2.0 (multi-user prod): CSRF-safe state via signed cookie AND/OR
 * server-side state rows, so login works even where third-party cookies are
 * blocked. Full RS256 id_token verification, D1 upsert, opaque session +
 * one-time grant for cookie-less frontends.
 */

export async function googleStart(req: Request, env: Env): Promise<Response> {
  const reqUrl = new URL(req.url);
  const clientState = reqUrl.searchParams.get("s") || "";
  // Preferred path: dashboard-generated state, recorded server-side.
  if (validClientState(clientState)) {
    await storeLoginState(env, clientState);
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri(env),
      response_type: "code",
      scope: "openid email profile",
      state: clientState,
      prompt: "select_account",
    });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }
  // Legacy path: server-generated state bound to a signed cookie.
  const state = randomToken().slice(0, 32);
  const exp = Date.now() + 5 * 60_000;
  const sig = await stateSig(state, exp, env.SESSION_SECRET);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return new Response(JSON.stringify({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Set-Cookie": `oauth_state=${state}.${exp}.${sig}; Path=/v1/auth/google/callback; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=300`,
    },
  });
}

export async function googleCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return json({ error: "google denied" }, 401);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return json(
      { error: "login not started — sign in from the dashboard instead of opening this URL directly" },
      400
    );
  }
  // State check: signed cookie (legacy) OR consumed server-side row (cookie-less).
  let stateOk = false;
  const cookie = getCookie(req, "oauth_state");
  if (cookie) {
    const [cState, cExp, cSig] = cookie.split(".");
    stateOk =
      cState === state &&
      !!cExp &&
      Number(cExp) >= Date.now() &&
      ((await stateSig(cState, Number(cExp), env.SESSION_SECRET)) === cSig);
  }
  if (!stateOk) stateOk = await consumeLoginState(env, state);
  if (!stateOk) {
    return json({ error: "login session expired or already used — please sign in again from the dashboard" }, 401);
  }

  // 1) Exchange code for tokens
  const tok = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(env),
      grant_type: "authorization_code",
    }),
  });
  if (!tok.ok) return json({ error: "token exchange failed" }, 502);
  const tj = (await tok.json()) as { id_token?: string };
  if (!tj.id_token) return json({ error: "no id_token" }, 502);

  // 2) Full signature verification
  let identity: { email: string; name: string; picture: string };
  try {
    identity = await verifyGoogleIdToken(tj.id_token, env.GOOGLE_CLIENT_ID);
  } catch {
    return json({ error: "invalid id_token" }, 401);
  }

  // 3) Upsert user (refresh name/picture on every login)
  let userId = `u_${await sha(`google:${identity.email}`)}`.slice(0, 24);
  try {
    if (env.DB) {
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ? LIMIT 1")
        .bind(identity.email)
        .first<{ id: string }>();
      if (existing) {
        userId = existing.id;
        await env.DB.prepare("UPDATE users SET name = ?, picture = ? WHERE id = ?")
          .bind(identity.name, identity.picture, userId)
          .run()
          .catch(() => null);
      } else {
        await env.DB.prepare("INSERT INTO users (id, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?)")
          .bind(userId, identity.email, identity.name, identity.picture, new Date().toISOString())
          .run();
      }
    }
  } catch {
    return json({ error: "user store failed" }, 500);
  }

  // 4) Opaque session (cookie for same-site browsers) + one-time grant so a
  // cross-site frontend can pick up the session without third-party cookies.
  let sessionId: string;
  let grant: string;
  try {
    sessionId = await createSession(env, userId);
    grant = await createGrant(env, userId);
  } catch {
    return json({ error: "session failed" }, 500);
  }
  const web = env.DASHBOARD_URL || env.WEB_BASE_URL || "/";
  return new Response(null, {
    status: 302,
    headers: {
      Location: `${web}/?login=ok&grant=${grant}&state=${state}`,
      "Set-Cookie": sessionCookie(sessionId),
    },
  });
}

async function stateSig(state: string, exp: number, secret: string): Promise<string> {
  return (await sha(`${state}.${exp}.${secret}`)).slice(0, 32);
}

function redirectUri(env: Env): string {
  return (
    (env as unknown as { GOOGLE_REDIRECT_URL?: string }).GOOGLE_REDIRECT_URL ||
    "http://127.0.0.1:8787/v1/auth/google/callback"
  );
}

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- id_token verification (RS256, Google certs, cached 1h) ---

let certCache: { at: number; keys: Record<string, CryptoKey> } | null = null;

function b64urlToBytes(s: string): Uint8Array {
  s = s.replaceAll("-", "+").replaceAll("_", "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function googleCerts(): Promise<Record<string, CryptoKey>> {
  if (certCache && Date.now() - certCache.at < 3600_000) return certCache.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error("cert fetch failed");
  const j = (await r.json()) as { keys: { kid: string }[] };
  const keys: Record<string, CryptoKey> = {};
  for (const k of j.keys) {
    keys[k.kid] = await crypto.subtle.importKey(
      "jwk",
      k as unknown as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  }
  certCache = { at: Date.now(), keys };
  return keys;
}

export async function verifyGoogleIdToken(
  idToken: string,
  clientId: string
): Promise<{ email: string; name: string; picture: string }> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0]))) as {
    kid?: string;
    alg?: string;
  };
  if (header.alg !== "RS256" || !header.kid) throw new Error("bad alg");
  const keys = await googleCerts();
  const key = keys[header.kid];
  if (!key) {
    certCache = null;
    throw new Error("unknown kid");
  }
  const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const sig = b64urlToBytes(parts[2]);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    sig.buffer as ArrayBuffer,
    signed.buffer as ArrayBuffer
  );
  if (!ok) throw new Error("bad signature");
  const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]))) as {
    aud?: string;
    iss?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (payload.aud !== clientId) throw new Error("bad audience");
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") {
    throw new Error("bad issuer");
  }
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) throw new Error("expired");
  const email = String(payload.email || "").toLowerCase();
  if (!payload.email_verified || !email) throw new Error("email not verified");
  return { email, name: String(payload.name || email), picture: String(payload.picture || "") };
}
