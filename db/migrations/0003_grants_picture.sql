-- 0003: one-time login grants (cookie-less session handoff for cross-site
-- frontends where third-party cookies are blocked) + Google avatar.
ALTER TABLE users ADD COLUMN picture TEXT;
CREATE TABLE IF NOT EXISTS grants (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_grants_user ON grants(user_id);
