-- Seed 12 urban contracts referencing CDMX corridors.
-- Threshold > 50 means travel time is 50%+ worse than free-flow.
-- Intentionally set low for early product validation — hedgers should experience payouts.

DO $$
DECLARE
  admin_id uuid := '58bbb04f-333c-4ffd-92c3-89f994586e23';
  urban_cat uuid;

  -- corridor ids resolved by slug
  cor_viaducto_am        uuid;
  cor_viaducto_pm        uuid;
  cor_bicentenario_am    uuid;
  cor_bicentenario_pm    uuid;
  cor_periferico_n_am    uuid;
  cor_periferico_n_pm    uuid;
  cor_periferico_s_am    uuid;
  cor_periferico_s_pm    uuid;
  cor_reforma_am         uuid;
  cor_reforma_pm         uuid;
  cor_palmas_am          uuid;
  cor_palmas_pm          uuid;

  -- contract ids (deterministic UUIDs for idempotency)
  c_viaducto_am       uuid := 'bbbbbbbb-0001-0000-0000-000000000001';
  c_viaducto_pm       uuid := 'bbbbbbbb-0001-0000-0000-000000000002';
  c_bicentenario_am   uuid := 'bbbbbbbb-0002-0000-0000-000000000001';
  c_bicentenario_pm   uuid := 'bbbbbbbb-0002-0000-0000-000000000002';
  c_periferico_n_am   uuid := 'bbbbbbbb-0003-0000-0000-000000000001';
  c_periferico_n_pm   uuid := 'bbbbbbbb-0003-0000-0000-000000000002';
  c_periferico_s_am   uuid := 'bbbbbbbb-0004-0000-0000-000000000001';
  c_periferico_s_pm   uuid := 'bbbbbbbb-0004-0000-0000-000000000002';
  c_reforma_am        uuid := 'bbbbbbbb-0005-0000-0000-000000000001';
  c_reforma_pm        uuid := 'bbbbbbbb-0005-0000-0000-000000000002';
  c_palmas_am         uuid := 'bbbbbbbb-0006-0000-0000-000000000001';
  c_palmas_pm         uuid := 'bbbbbbbb-0006-0000-0000-000000000002';

BEGIN
  SELECT id INTO urban_cat FROM categories WHERE slug = 'urban';

  SELECT id INTO cor_viaducto_am     FROM corridors WHERE slug = 'viaducto-am';
  SELECT id INTO cor_viaducto_pm     FROM corridors WHERE slug = 'viaducto-pm';
  SELECT id INTO cor_bicentenario_am FROM corridors WHERE slug = 'bicentenario-am';
  SELECT id INTO cor_bicentenario_pm FROM corridors WHERE slug = 'bicentenario-pm';
  SELECT id INTO cor_periferico_n_am FROM corridors WHERE slug = 'periferico-norte-am';
  SELECT id INTO cor_periferico_n_pm FROM corridors WHERE slug = 'periferico-norte-pm';
  SELECT id INTO cor_periferico_s_am FROM corridors WHERE slug = 'periferico-sur-am';
  SELECT id INTO cor_periferico_s_pm FROM corridors WHERE slug = 'periferico-sur-pm';
  SELECT id INTO cor_reforma_am      FROM corridors WHERE slug = 'reforma-am';
  SELECT id INTO cor_reforma_pm      FROM corridors WHERE slug = 'reforma-pm';
  SELECT id INTO cor_palmas_am       FROM corridors WHERE slug = 'palmas-am';
  SELECT id INTO cor_palmas_pm       FROM corridors WHERE slug = 'palmas-pm';

  -- Guard: fail explicitly rather than silently inserting NULL foreign keys
  IF urban_cat IS NULL THEN
    RAISE EXCEPTION 'Category "urban" not found — run category seed migration first';
  END IF;
  IF cor_viaducto_am IS NULL OR cor_viaducto_pm IS NULL
     OR cor_bicentenario_am IS NULL OR cor_bicentenario_pm IS NULL
     OR cor_periferico_n_am IS NULL OR cor_periferico_n_pm IS NULL
     OR cor_periferico_s_am IS NULL OR cor_periferico_s_pm IS NULL
     OR cor_reforma_am IS NULL OR cor_reforma_pm IS NULL
     OR cor_palmas_am IS NULL OR cor_palmas_pm IS NULL THEN
    RAISE EXCEPTION 'One or more corridor slugs not found — run corridor seed migration first';
  END IF;

  INSERT INTO contracts (
    id, slug, title, description, category_id, status,
    trigger_type, trigger_condition, trigger_deadline,
    location, corridor_id, total_volume_usd, total_volume_mxn,
    is_featured, created_by
  ) VALUES

  (c_viaducto_am, 'viaducto-oriente-manana',
   'Viaducto Oriente — Protección Mañana',
   'Cobertura para el trayecto Constituyentes → Aeropuerto por el Viaducto Miguel Alemán durante la mañana. Paga si el tiempo de traslado supera 50% del normal.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.3983,"lng":-99.1918}',
   cor_viaducto_am, 0, 0, true, admin_id),

  (c_viaducto_pm, 'viaducto-poniente-tarde',
   'Viaducto Poniente — Protección Tarde',
   'Cobertura para el trayecto Aeropuerto → Constituyentes por el Viaducto Miguel Alemán durante la tarde. Paga si el tiempo de traslado supera 50% del normal.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4147,"lng":-99.0790}',
   cor_viaducto_pm, 0, 0, false, admin_id),

  (c_bicentenario_am, 'bicentenario-sur-manana',
   'Bicentenario Sur — Protección Mañana',
   'Cobertura del Circuito Bicentenario en dirección sur durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4487,"lng":-99.1374}',
   cor_bicentenario_am, 0, 0, false, admin_id),

  (c_bicentenario_pm, 'bicentenario-norte-tarde',
   'Bicentenario Norte — Protección Tarde',
   'Cobertura del Circuito Bicentenario en dirección norte durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.3749,"lng":-99.1836}',
   cor_bicentenario_pm, 0, 0, false, admin_id),

  (c_periferico_n_am, 'periferico-norte-centro-manana',
   'Periférico Norte → Centro — Protección Mañana',
   'Cobertura de Cuatro Caminos hacia Constituyentes por Periférico Norte durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4726,"lng":-99.1758}',
   cor_periferico_n_am, 0, 0, false, admin_id),

  (c_periferico_n_pm, 'periferico-norte-cuatro-caminos-tarde',
   'Periférico Norte → Cuatro Caminos — Protección Tarde',
   'Cobertura de Constituyentes hacia Cuatro Caminos por Periférico Norte durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4153,"lng":-99.2054}',
   cor_periferico_n_pm, 0, 0, false, admin_id),

  (c_periferico_s_am, 'periferico-sur-centro-manana',
   'Periférico Sur → Centro — Protección Mañana',
   'Cobertura del Estadio Azteca hacia Insurgentes Sur por Periférico Sur durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.3030,"lng":-99.1507}',
   cor_periferico_s_am, 0, 0, false, admin_id),

  (c_periferico_s_pm, 'periferico-sur-azteca-tarde',
   'Periférico Sur → Azteca — Protección Tarde',
   'Cobertura de Insurgentes Sur hacia Estadio Azteca por Periférico Sur durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.3601,"lng":-99.1733}',
   cor_periferico_s_pm, 0, 0, false, admin_id),

  (c_reforma_am, 'reforma-alameda-manana',
   'Reforma → Alameda — Protección Mañana',
   'Cobertura del Paseo de la Reforma de Observatorio hacia Alameda Central durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4001,"lng":-99.1892}',
   cor_reforma_am, 0, 0, true, admin_id),

  (c_reforma_pm, 'reforma-observatorio-tarde',
   'Reforma → Observatorio — Protección Tarde',
   'Cobertura del Paseo de la Reforma de Alameda Central hacia Observatorio durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4354,"lng":-99.1452}',
   cor_reforma_pm, 0, 0, false, admin_id),

  (c_palmas_am, 'palmas-reforma-manana',
   'Palmas → Reforma — Protección Mañana',
   'Cobertura de Av. de las Palmas de Bosques de las Lomas hacia Fuente de Petróleos durante la mañana.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 10:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4218,"lng":-99.2519}',
   cor_palmas_am, 0, 0, false, admin_id),

  (c_palmas_pm, 'palmas-bosques-tarde',
   'Palmas → Bosques — Protección Tarde',
   'Cobertura de Av. de las Palmas de Fuente de Petróleos hacia Bosques de las Lomas durante la tarde.',
   urban_cat, 'active', 'urban',
   '{"metric":"traffic_index","operator":"gt","threshold":50,"description":"Travel time at least 50% worse than a typical rush hour"}',
   '2026-12-31 20:00:00+00',
   '{"city":"Mexico City","country":"MX","lat":19.4199,"lng":-99.2138}',
   cor_palmas_pm, 0, 0, false, admin_id);

  -- Coverage tiers for all 12 contracts
  INSERT INTO coverage_tiers (contract_id, name, premium_usd, payout_usd, premium_mxn, payout_mxn, max_capacity_usd, base_probability)
  SELECT id, 'basic',   29,  500,  493, 8500,  50000, 0.35 FROM contracts WHERE id IN (c_viaducto_am, c_viaducto_pm, c_bicentenario_am, c_bicentenario_pm, c_periferico_n_am, c_periferico_n_pm, c_periferico_s_am, c_periferico_s_pm, c_reforma_am, c_reforma_pm, c_palmas_am, c_palmas_pm)
  UNION ALL
  SELECT id, 'premium', 89, 2000, 1513, 34000, 50000, 0.35 FROM contracts WHERE id IN (c_viaducto_am, c_viaducto_pm, c_bicentenario_am, c_bicentenario_pm, c_periferico_n_am, c_periferico_n_pm, c_periferico_s_am, c_periferico_s_pm, c_reforma_am, c_reforma_pm, c_palmas_am, c_palmas_pm);

END $$;
