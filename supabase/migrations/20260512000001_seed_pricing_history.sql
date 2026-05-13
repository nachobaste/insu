-- Insert one initial pricing history row per coverage tier using current premium values.
-- This gives the SP2 chart at least one data point per tier before the SP3 pricing engine runs.
INSERT INTO pricing_history (contract_id, tier_id, bs_inputs, bs_output, premium_usd_before, premium_usd_after, calculated_at)
SELECT
  t.contract_id,
  t.id,
  '{}'::jsonb,
  '{}'::jsonb,
  t.premium_usd,
  t.premium_usd,
  now()
FROM coverage_tiers t;
