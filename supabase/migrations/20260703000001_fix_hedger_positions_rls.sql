-- ─── FIX: hedger_positions column-level write gap ───────────────────────────
-- The prior INSERT/UPDATE policies only checked row ownership (auth.uid() =
-- user_id). Because Postgres RLS is row-level (not column-level), an
-- authenticated user could use the public anon key to write privileged columns
-- directly via PostgREST — inserting a position with status = 'active', or
-- flipping an unpaid 'pending_payment' row to 'active' — thereby obtaining
-- coverage for $0 premium and collecting real payouts when the oracle triggers.
--
-- Legitimate lifecycle writes do NOT need these open policies:
--   * position creation → server action inserts status = 'pending_payment'
--   * activation        → service-role (verifies the Stripe payment first)
--   * payout / expiry   → service-role (cron + admin)
-- Only the SELECT policy ("Own hedger positions") is needed by user context.

-- 1. Remove the unrestricted user UPDATE path entirely. No user-context code
--    updates hedger_positions; every status transition runs as service role.
DROP POLICY IF EXISTS "Own hedger positions update" ON hedger_positions;

-- 2. Constrain INSERT so a user can only create their own row in the
--    unpaid 'pending_payment' state. Activation to 'active' remains
--    service-role-only, gated on verified payment.
DROP POLICY IF EXISTS "Insert hedger position" ON hedger_positions;
CREATE POLICY "Insert hedger position" ON hedger_positions
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending_payment'
  );
