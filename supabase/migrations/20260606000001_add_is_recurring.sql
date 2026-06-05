-- supabase/migrations/20260606000001_add_is_recurring.sql

ALTER TABLE contracts
  ADD COLUMN is_recurring boolean NOT NULL DEFAULT false;

-- Recurring: weather and urban contracts always roll over
UPDATE contracts SET is_recurring = true
WHERE trigger_type IN ('weather', 'urban');

-- Recurring contracts have no meaningful hard deadline
ALTER TABLE contracts
  ALTER COLUMN trigger_deadline DROP NOT NULL;
