-- ─── FIX: provider_positions column-level write gap ─────────────────────────
-- Sibling of 20260703000001 (hedger_positions). The "Insert provider position"
-- policy only checked row ownership (auth.uid() = user_id), so — because RLS is
-- row-level and the browser uses the public anon key — an authenticated user
-- could PostgREST-insert a provider position with status = 'active' and an
-- arbitrary capital_deposited_usd without paying.
--
-- Impact is lower than the hedger case: provider settlement only records
-- actual_return_usd (no automatic Stripe payout), and a direct insert never
-- calls increment_tier_capacity, so it cannot inflate purchasable capacity.
-- It's a data-integrity / forged-position issue with the same root cause, so we
-- lock it the same way.
--
-- Legitimate lifecycle writes do NOT need an open policy:
--   * position creation → server action inserts status = 'pending_payment'
--   * activation        → service-role (verifies the Stripe payment first)
--   * settlement        → service-role (cron)
-- Only the SELECT policy ("Own provider positions") is needed by user context.

-- 1. Remove the unrestricted user UPDATE path (added in 20260524000001). No
--    user-context code updates provider_positions; activation and settlement
--    all run as service role.
DROP POLICY IF EXISTS "Own provider positions update" ON provider_positions;

-- 2. Constrain INSERT to the unpaid 'pending_payment' state for one's own row.
DROP POLICY IF EXISTS "Insert provider position" ON provider_positions;
CREATE POLICY "Insert provider position" ON provider_positions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending_payment'
  );
