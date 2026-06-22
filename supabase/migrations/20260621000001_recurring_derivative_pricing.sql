-- Recurring derivative-style pricing: per-position multi-payout + perpetual markets.

-- 1. coverage_tiers: how many times a position on this tier can pay out.
ALTER TABLE coverage_tiers
  ADD COLUMN IF NOT EXISTS max_payouts integer NOT NULL DEFAULT 1;

UPDATE coverage_tiers SET max_payouts = 1 WHERE name = 'basic';
UPDATE coverage_tiers SET max_payouts = 3 WHERE name = 'premium';

-- 2. hedger_positions: per-position multi-payout + capital reservation.
ALTER TABLE hedger_positions
  ADD COLUMN IF NOT EXISTS payouts_remaining integer,
  ADD COLUMN IF NOT EXISTS payouts_made integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_payout_date date,
  ADD COLUMN IF NOT EXISTS reserved_usd numeric;

-- Backfill open/pending positions: reserve max_payouts x payout, set remaining.
UPDATE hedger_positions hp
SET payouts_remaining = COALESCE(hp.payouts_remaining, ct.max_payouts),
    reserved_usd       = COALESCE(hp.reserved_usd, ct.max_payouts * hp.payout_amount_usd)
FROM coverage_tiers ct
WHERE hp.tier_id = ct.id
  AND hp.status IN ('active', 'pending_payment');

-- 3. Recurring contracts are perpetual: drop the deadline for all recurring
--    markets (is_recurring = true covers weather + urban).
UPDATE contracts
SET trigger_deadline = NULL
WHERE is_recurring = true;

-- 4. Re-baseline base_probability as a DAILY hazard for recurring corridors.
--    Prior values were full-window probabilities. 0.05 = ~5% of days breach;
--    admins tune per-corridor afterwards.
UPDATE coverage_tiers ct
SET base_probability = 0.05
FROM contracts c
WHERE ct.contract_id = c.id
  AND c.is_recurring = true;

-- 5. payouts: one payout per (position, day) for multi-payout Pro positions.
ALTER TABLE payouts ADD COLUMN IF NOT EXISTS trigger_day date;
-- Drop the old position-level unique constraint (added by 20260525000001_payout_unique_constraint.sql):
DROP INDEX IF EXISTS payouts_hedger_position_id_unique;
ALTER TABLE payouts DROP CONSTRAINT IF EXISTS payouts_hedger_position_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS payouts_position_day_uniq
  ON payouts (hedger_position_id, trigger_day) WHERE status <> 'failed';
