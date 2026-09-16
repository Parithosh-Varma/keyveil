// Shared KeyVeil web client: API base resolution, authed fetch, input parsing.
export const PROD_API = "https://keyveil-api.parithosh.workers.dev";
export const LOCAL_API = "http://127.0.0.1:8787";

const host =
  typeof location !== "undefined" ? location.hostname : "";

function allowedApiBase(url: string): string | null {
  // Allow-list: the session bearer in localStorage is sent to whatever API
  // base is configured, so an arbitrary URL here is a token-exfil primitive
  // (poisoned localStorage, pasted "debug" URL). Only our prod API and the
  // local dev worker are ever valid targets.
  const clean = url.replace(/\/$/, "");
  return clean === PROD_API || clean === LOCAL_API ? clean : null;
}

const stored =
  typeof localStorage !== "undefined" ? localStorage.getItem("api_base") : null;
export let API: string =
  (stored && allowedApiBase(stored)) ||
  (host === "localhost" || host === "127.0.0.1" ? LOCAL_API : PROD_API);

export function setApiBase(url: string): string {
  const clean = allowedApiBase(url);
  if (!clean) throw new Error(`refusing unknown API base: ${url}`);
  API = clean;
  try {
    localStorage.setItem("api_base", API);
  } catch {
    /* private mode */
  }
  return API;
}

export class ApiError extends Error {
  status: number;
  need?: string;
  constructor(status: number, message: string, need?: string) {
    super(message);
    this.status = status;
    this.need = need;
  }
}

export interface ToolsResponse {
  tools: Array<{ provider: string; action: string; description: string }>;
}

const SESSION_KEY = "kv_session";

export function loadSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function saveSessionToken(token: string) {
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    /* private mode */
  }
}

export function clearSessionToken() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode */
  }
}

export async function api<T = Record<string, unknown>>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sess = loadSessionToken();
  if (sess) headers["Authorization"] = `Bearer ${sess}`;
  const res = await fetch(API + path, {
    method: opts.method || "GET",
    credentials: "include",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: string;
    need?: string;
  };
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText, data.need);
  return data as T;
}

export function describeApiError(e: unknown, what: string): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return `${what}: not logged in — type login`;
    if (e.status === 403) return `${what}: denied${e.need ? ` (need scope: ${e.need})` : ""}`;
    return `${what}: ${e.message}`;
  }
  if (e instanceof TypeError) return `${what}: cannot reach ${API}`;
  return `${what}: ${e instanceof Error ? e.message : String(e)}`;
}

/** Split a command line on whitespace, respecting single/double quotes. */
export function tokenize(line: string): string[] {
  const m = line.match(/"([^"]*)"|'([^']*)'|\S+/g) || [];
  return m.map((t) => t.replace(/^["']|["']$/g, ""));
}

export interface FlagArgs {
  _: string[];
  [k: string]: string | string[];
}

export function parseFlags(args: string[]): FlagArgs {
  const out: FlagArgs = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const k = args[i].slice(2);
      out[k] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    } else out._.push(args[i]);
  }
  return out;
}

export function cleanName(n: string | undefined): string | null {
  const c = String(n || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 64);
  return c || null;
}
