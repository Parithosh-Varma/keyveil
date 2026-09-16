import type { Env } from "../types";
import { loadUserSecret, audit } from "../lib/vault";
import { clientIp, json } from "../lib/auth";

/** Blind proxy: inject the user's secret server-side, return only the upstream result. */

// Small, cheap chat models agents may bill. Owners opt into more by editing
// this list — never accept an arbitrary model string from the caller.
const ALLOWED_CHAT_MODELS = new Set([
  "gpt-4o-mini",
  "gpt-4o",
  "gpt-4.1-mini",
  "gpt-4.1",
  "o4-mini",
  "o3-mini",
]);

function stripSensitiveHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "cookie" || lk === "set-cookie") return;
    out[k] = v;
  });
  return out;
}

export async function proxyGithubCreateRepo(
  req: Request,
  env: Env,
  userId: string,
  body: { name?: string; isPublic?: boolean }
): Promise<Response> {
  const ip = clientIp(req);
  const token = await loadUserSecret(env, userId, "GITHUB_TOKEN");
  if (!token) {
    await audit(env, { user_id: userId, actor: "agent", provider: "github", action: "create-repo:missing-secret", ok: false, ip });
    return json({ error: "no GITHUB_TOKEN stored for this user" }, 404);
  }
  const name = (body.name || "").trim();
  if (!/^[\w.-]{1,100}$/.test(name)) return json({ error: "invalid repo name" }, 400);
  // Default to PRIVATE: only an explicit isPublic:true creates a public repo.
  // (The old `isPublic === false` check defaulted undefined -> public.)
  const isPublic = body.isPublic === true;
  const upstream = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "keyveil-gateway",
    },
    body: JSON.stringify({ name, private: !isPublic }),
  });
  const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  await audit(env, {
    user_id: userId,
    actor: "agent",
    provider: "github",
    action: "create-repo",
    ok: upstream.ok,
    ip,
  });
  if (!upstream.ok) return json({ error: "github failed", detail: data }, upstream.status);
  // Return allowlisted fields only — never echo the token.
  return json({ url: data.html_url, full_name: data.full_name, private: data.private });
}

export async function proxyOpenAiChat(
  req: Request,
  env: Env,
  userId: string,
  body: { model?: string; input?: string }
): Promise<Response> {
  const ip = clientIp(req);
  const key = await loadUserSecret(env, userId, "OPENAI_API_KEY");
  if (!key) {
    await audit(env, { user_id: userId, actor: "agent", provider: "openai", action: "chat:missing-secret", ok: false, ip });
    return json({ error: "no OPENAI_API_KEY stored for this user" }, 404);
  }
  // Allow-list cheap chat models: an agent key with openai:chat must not be
  // able to bill the owner for arbitrary (expensive/experimental) models.
  const model = (body.model || "gpt-4o-mini").slice(0, 64);
  if (!ALLOWED_CHAT_MODELS.has(model)) {
    await audit(env, { user_id: userId, actor: "agent", provider: "openai", action: "chat:denied-model", ok: false, ip });
    return json({ error: "model not allowed", allowed: [...ALLOWED_CHAT_MODELS] }, 400);
  }
  const input = (body.input || "").slice(0, 8000);
  if (!input) return json({ error: "input required" }, 400);
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input }),
  });
  const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  await audit(env, { user_id: userId, actor: "agent", provider: "openai", action: "chat", ok: upstream.ok, ip });
  if (!upstream.ok) return json({ error: "openai failed" }, upstream.status);
  void stripSensitiveHeaders;
  return json({ result: data });
}
