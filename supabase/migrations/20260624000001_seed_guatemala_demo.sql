-- Guatemala City demo contract: Carretera a El Salvador inbound to Zona 10 (AM).
-- International contract (location.country = 'GT') for an investor demo.
-- Idempotent: ON CONFLICT / NOT EXISTS guards so re-running is safe.

-- 1. Corridor: Carretera a El Salvador (Muxbal / Santa Catarina Pinula) -> Zona 10.
--    Window 07:00-10:00 local (Guatemala is UTC-6, like CDMX) so the existing
--    urban oracle poll covers it with no extra cron config.
INSERT INTO corridors (slug, name, road, origin_lat, origin_lng, dest_lat, dest_lng, window_start, window_end)
VALUES (
  'gt-cesa-zona10-am',
  'Carretera a El Salvador → Zona 10 (Mañana)',
  'Carretera a El Salvador (CA-1 Oriente)',
  14.5535, -90.4760,   -- origin: Muxbal / Santa Catarina Pinula
  14.5975, -90.5130,   -- dest: Zona 10 / Bulevar Los Próceres
  '07:00', '10:00'
)
ON CONFLICT (slug) DO NOTHING;

-- 2. Contract + tiers (recurring, perpetual market) referencing the corridor.
DO $$
DECLARE
  admin_id  uuid := '4e68ce38-e75d-470c-bf5f-e72511f94b18';  -- Gerardo Basterrechea (admin)
  urban_cat uuid;
  cor_gt    uuid;
  c_gt      uuid := 'bbbbbbbb-0007-0000-0000-000000000001';  -- deterministic for idempotency
BEGIN
  SELECT id INTO urban_cat FROM categories WHERE slug = 'urban';
  SELECT id INTO cor_gt   FROM corridors  WHERE slug = 'gt-cesa-zona10-am';

  IF urban_cat IS NULL THEN
    RAISE EXCEPTION 'Category "urban" not found — run category seed migration first';
  END IF;
  IF cor_gt IS NULL THEN
    RAISE EXCEPTION 'Corridor gt-cesa-zona10-am not found — corridor insert above did not run';
  END IF;

  INSERT INTO contracts (
    id, slug, title, description, category_id, status,
    trigger_type, trigger_condition, trigger_deadline,
    location, corridor_id, total_volume_usd, total_volume_mxn,
    is_featured, is_recurring, created_by
  ) VALUES (
    c_gt,
    'gt-cesa-zona10-manana',
    'Carretera a El Salvador → Zona 10 — Protección Mañana',
    'Cobertura para el trayecto matutino desde Carretera a El Salvador (Muxbal / Santa Catarina Pinula) hacia la Zona 10. Paga si el tiempo de traslado supera 50% del normal.',
    urban_cat, 'active', 'urban',
    '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
    NULL,  -- recurring market: no deadline
    '{"city":"Guatemala City","country":"GT","lat":14.5975,"lng":-90.5130}',
    cor_gt, 0, 0,
    true, true, admin_id
  )
  ON CONFLICT (id) DO NOTHING;

  -- Tiers: Basic (1 payout) + Pro (up to 3). base_probability 0.05 = daily hazard,
  -- matching the other recurring corridors. premium_*_mxn columns are required but
  -- not shown in the USD International view; set to ~GTQ equivalents (USD x 7.8).
  IF NOT EXISTS (SELECT 1 FROM coverage_tiers WHERE contract_id = c_gt) THEN
    INSERT INTO coverage_tiers
      (contract_id, name, premium_usd, payout_usd, premium_mxn, payout_mxn, max_capacity_usd, base_probability, max_payouts)
    VALUES
      (c_gt, 'basic',   29,  500,  226,  3900, 50000, 0.05, 1),
      (c_gt, 'premium', 89, 2000,  694, 15600, 50000, 0.05, 3);
  END IF;
END $$;
