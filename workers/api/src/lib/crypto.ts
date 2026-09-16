import type { Env } from "../types";

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKek(kekB64OrRaw: string): Promise<CryptoKey> {
  // KEK should be 32 random bytes, base64-encoded, stored via `wrangler secret put ENCRYPTION_KEK`.
  let raw: Uint8Array;
  try {
    raw = b64decode(kekB64OrRaw);
  } catch {
    raw = enc.encode(kekB64OrRaw);
  }
  const keyBytes = raw.length === 32 ? raw : (await crypto.subtle.digest("SHA-256", raw as BufferSource));
  return crypto.subtle.importKey("raw", keyBytes as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypt a per-user secret value. Returns "v1.<iv>.<ciphertext>" (base64). */
export async function encryptSecret(env: Env, plaintext: string): Promise<string> {
  const key = await importKek(env.ENCRYPTION_KEK);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode(plaintext) as BufferSource);
  return `v1.${b64encode(iv)}.${b64encode(new Uint8Array(ct))}`;
}

export async function decryptSecret(env: Env, payload: string): Promise<string> {
  const key = await importKek(env.ENCRYPTION_KEK);
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") throw new Error("bad payload");
  const iv = b64decode(parts[1]);
  const ct = b64decode(parts[2]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ct as BufferSource);
  return dec.decode(pt);
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s) as BufferSource);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newAgentToken(): { publicId: string; secret: string; prefix: string } {
  const publicId = crypto.randomUUID().slice(0, 8);
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = b64encode(bytes).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  const prefix = `tv_live_${publicId}`;
  return { publicId, secret, prefix };
}

export function fullAgentToken(prefix: string, secret: string): string {
  return `${prefix}.${secret}`;
}
