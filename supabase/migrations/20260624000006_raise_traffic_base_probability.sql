-- Raise the trigger probability on the CDMX traffic-corridor tiers so live
-- quotes feel intentional rather than trivially cheap. At the old 0.05
-- placeholder a 1-day Basic ($100) quoted ~$2 on a calm day; at 0.12 it lands
-- around ~$8 on a typical day (and scales up when traffic is already elevated).
--
-- NOTE: 0.12 is still a judgement value, not yet derived from oracle history —
-- re-tune via scripts/tune-base-probability.mjs once ~30 days of readings exist.
-- The premium cap (MAX_PREMIUM_FRACTION in lib/pricing/derivative.ts) keeps the
-- longer tenors coherent now that probability is higher.
--
-- Scoped to traffic_index contracts only; the São Paulo metro-shutdown trigger
-- is rarer and keeps its own probability.

UPDATE coverage_tiers t
SET base_probability = 0.12
FROM contracts c
WHERE t.contract_id = c.id
  AND c.trigger_condition->>'metric' = 'traffic_index';
