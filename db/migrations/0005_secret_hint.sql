-- 0005: masked hint for secret list display (e.g. "sk-…c123").
-- Stripe-style: first 3 + last 4 chars only. Never enough to reconstruct.
ALTER TABLE secrets ADD COLUMN hint TEXT;
