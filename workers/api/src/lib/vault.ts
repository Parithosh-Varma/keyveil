import type { Env } from "../types";

/** Load a user's decrypted secret by name. KV holds ciphertext, D1 holds pointer metadata. */
export async function loadUserSecret(env: Env, userId: string, name: string): Promise<string | null> {
  const { decryptSecret } = await import("./crypto");
  if (env.VAULT_KV) {
    const payload = await env.VAULT_KV.get(`u:${userId}:s:${name}`);
    if (payload) {
      try {
        return await decryptSecret(env, payload);
      } catch {
        return null;
      }
    }
  }
  if (env.DB) {
    const row = await env.DB.prepare(
      "SELECT ciphertext FROM secrets WHERE user_id = ? AND name = ? LIMIT 1"
    )
      .bind(userId, name)
      .first<{ ciphertext: string }>();
    if (row) {
      try {
        return await decryptSecret(env, row.ciphertext);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export async function audit(
  env: Env,
  entry: { user_id: string; actor: string; provider?: string; action: string; ok: boolean; ip: string }
): Promise<void> {
  // Never log secret values here — only who/what/when.
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      "INSERT INTO audit_log (id, user_id, actor, provider, action, ok, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
      .bind(
        crypto.randomUUID(),
        entry.user_id,
        entry.actor,
        entry.provider || null,
        entry.action,
        entry.ok ? 1 : 0,
        entry.ip,
        new Date().toISOString()
      )
      .run();
  } catch {
    // audit must never break the request
  }
}
