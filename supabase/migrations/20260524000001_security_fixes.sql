-- ─── ATOMIC INCREMENT HELPERS ───────────────────────────────────────────────
-- Prevents race conditions when concurrent purchases update the same counters.
CREATE OR REPLACE FUNCTION increment_tier_capacity(p_tier_id uuid, p_amount numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE coverage_tiers
  SET current_capacity_usd = current_capacity_usd + p_amount
  WHERE id = p_tier_id;
$$;

CREATE OR REPLACE FUNCTION increment_contract_volume(p_contract_id uuid, p_amount numeric)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE contracts
  SET total_volume_usd = total_volume_usd + p_amount
  WHERE id = p_contract_id;
$$;

-- ─── MISSING RLS POLICIES ────────────────────────────────────────────────────

-- contracts: allow authenticated users to submit pending contracts;
-- all other writes remain service-role-only (admin actions bypass RLS).
CREATE POLICY "Users can submit pending contracts" ON contracts
  FOR INSERT
  WITH CHECK (
    auth.uid() = created_by
    AND status = 'pending'
  );

-- hedger_positions: users can only update their own rows (e.g. cancel);
-- service role bypasses RLS for activation by webhook/server action.
CREATE POLICY "Own hedger positions update" ON hedger_positions
  FOR UPDATE
  USING (auth.uid() = user_id);

-- provider_positions: same pattern.
CREATE POLICY "Own provider positions update" ON provider_positions
  FOR UPDATE
  USING (auth.uid() = user_id);

-- oracle_readings: no user INSERT policy — only service role may write readings.
-- payouts, pricing_history, coverage_tiers: no user write policies — service role only.
