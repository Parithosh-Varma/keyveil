import type { Env } from "../types";
import { loadUserSecret, audit } from "../lib/vault";
import { clientIp, json } from "../lib/auth";

/** Blind proxy: inject the user's secret server-side, return only the upstream result. */

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
  const upstream = await fetch("https://api.github.com/user/repos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "api-tokens-gateway",
    },
    body: JSON.stringify({ name, private: body.isPublic === false }),
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
  const model = (body.model || "gpt-4o-mini").slice(0, 64);
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
