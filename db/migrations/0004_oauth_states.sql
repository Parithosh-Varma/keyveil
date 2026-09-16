-- 0004: server-side OAuth states so login works even where third-party
-- cookies are blocked. The dashboard also echo-checks the state.
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_exp ON oauth_states(expires_at);
