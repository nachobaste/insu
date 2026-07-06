-- Guatemala City evening contract: Zona 10 outbound to Carretera a El Salvador (PM).
-- Completes the AM/PM pair for the corridor, matching the CDMX pattern where every
-- road has a morning (inbound) and evening (outbound) contract.
-- Idempotent: ON CONFLICT / NOT EXISTS guards so re-running is safe.

-- 1. Corridor: Zona 10 -> Carretera a El Salvador (Muxbal / Santa Catarina Pinula),
--    the AM corridor reversed. Window 17:00-20:00 local (Guatemala is UTC-6, like
--    CDMX) so the existing urban oracle poll covers it with no extra cron config.
--    baseline_duration_s starts NULL -> oracle falls back to Google free-flow until
--    compute-corridor-baselines.mjs runs with enough reading history.
INSERT INTO corridors (slug, name, road, origin_lat, origin_lng, dest_lat, dest_lng, window_start, window_end)
VALUES (
  'gt-cesa-zona10-pm',
  'Zona 10 → Carretera a El Salvador (Tarde)',
  'Carretera a El Salvador (CA-1 Oriente)',
  14.5975, -90.5130,   -- origin: Zona 10 / Bulevar Los Próceres
  14.5535, -90.4760,   -- dest: Muxbal / Santa Catarina Pinula
  '17:00', '20:00'
)
ON CONFLICT (slug) DO NOTHING;

-- 2. Contract + tiers (recurring, perpetual market) referencing the corridor.
DO $$
DECLARE
  admin_id  uuid := '4e68ce38-e75d-470c-bf5f-e72511f94b18';  -- Gerardo Basterrechea (admin)
  urban_cat uuid;
  cor_gt    uuid;
  c_gt      uuid := 'bbbbbbbb-0007-0000-0000-000000000002';  -- deterministic for idempotency
BEGIN
  SELECT id INTO urban_cat FROM categories WHERE slug = 'urban';
  SELECT id INTO cor_gt   FROM corridors  WHERE slug = 'gt-cesa-zona10-pm';

  IF urban_cat IS NULL THEN
    RAISE EXCEPTION 'Category "urban" not found — run category seed migration first';
  END IF;
  IF cor_gt IS NULL THEN
    RAISE EXCEPTION 'Corridor gt-cesa-zona10-pm not found — corridor insert above did not run';
  END IF;

  INSERT INTO contracts (
    id, slug, title, description, category_id, status,
    trigger_type, trigger_condition, trigger_deadline,
    location, corridor_id, total_volume_usd, total_volume_mxn,
    is_featured, is_recurring, created_by
  ) VALUES (
    c_gt,
    'gt-cesa-zona10-tarde',
    'Zona 10 → Carretera a El Salvador — Protección Tarde',
    'Cobertura para el trayecto vespertino desde la Zona 10 hacia Carretera a El Salvador (Muxbal / Santa Catarina Pinula). Paga si el tiempo de traslado supera 50% del normal.',
    urban_cat, 'active', 'urban',
    '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
    NULL,  -- recurring market: no deadline
    '{"city":"Guatemala City","country":"GT","lat":14.5975,"lng":-90.5130}',
    cor_gt, 0, 0,
    false, true, admin_id
  )
  ON CONFLICT (id) DO NOTHING;

  -- Tiers: match the AM contract's CURRENT prod values (after the 2026-06-24
  -- payout lowering and base_probability raise, which both targeted every
  -- traffic_index contract): Basic $6 -> $100 x1, Pro $22 -> $500 x3, 0.12/day.
  IF NOT EXISTS (SELECT 1 FROM coverage_tiers WHERE contract_id = c_gt) THEN
    INSERT INTO coverage_tiers
      (contract_id, name, premium_usd, payout_usd, premium_mxn, payout_mxn, max_capacity_usd, base_probability, max_payouts)
    VALUES
      (c_gt, 'basic',    6,  100,  99, 1700, 50000, 0.12, 1),
      (c_gt, 'premium', 22,  500, 378, 8500, 50000, 0.12, 3);
  END IF;

  -- Demo funding, like the AM contract (20260624000002): a brand-new contract
  -- starts at current_capacity_usd = 0, which blocks buyers. Set levels above
  -- max_payouts x payout so both the client and server purchase gates pass.
  UPDATE coverage_tiers ct
  SET current_capacity_usd = CASE ct.name
        WHEN 'basic'   THEN 12000   -- payout 100 x1 -> need >= 100
        WHEN 'premium' THEN 20000   -- payout 500 x3 -> need >= 1500
        ELSE ct.current_capacity_usd
      END
  WHERE ct.contract_id = c_gt
    AND ct.current_capacity_usd = 0;
END $$;
