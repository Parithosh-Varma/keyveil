-- 0006: single-use (or N-use) agent keys. max_uses NULL = unlimited.
-- Every proxy call and every agent-minted key consumes one use, atomically.
ALTER TABLE agent_keys ADD COLUMN max_uses INTEGER;
ALTER TABLE agent_keys ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
