export interface Env {
  DB?: D1Database;
  VEIL_KV?: KVNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ENCRYPTION_KEK: string;
  WEB_BASE_URL: string;
  DASHBOARD_URL: string;
}

export interface AgentKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string; // JSON array
  ip_allowlist: string | null; // JSON array of CIDR/IP, nullable
  expires_at: string | null;
  revoked_at: string | null;
  max_uses: number | null;
  uses: number;
  created_at: string;
}

export const TOOLS = [
  {
    name: "github/create-repo",
    provider: "github",
    action: "create-repo",
    description: "Create a GitHub repo using the user's stored GITHUB_TOKEN. Never returns the token.",
    input: { name: "string", isPublic: "boolean" },
  },
  {
    name: "openai/chat",
    provider: "openai",
    action: "chat",
    description: "Call OpenAI chat completion with user's OPENAI_API_KEY. Returns text only.",
    input: { model: "string", input: "string" },
  },
] as const;
