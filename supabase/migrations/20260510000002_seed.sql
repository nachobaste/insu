-- supabase/migrations/20260510000002_seed.sql

-- Categories
INSERT INTO categories (id, name, slug, color, display_order) VALUES
  ('11111111-0000-0000-0000-000000000001', 'Urban',       'urban',       '#94a3b8', 1),
  ('11111111-0000-0000-0000-000000000002', 'Nature',      'nature',      '#34d399', 2),
  ('11111111-0000-0000-0000-000000000003', 'Experiences', 'experiences', '#fb923c', 3),
  ('11111111-0000-0000-0000-000000000004', 'Events',      'events',      '#a78bfa', 4)
ON CONFLICT (id) DO NOTHING;

-- Sample contracts and tiers are inserted via the admin panel (sub-project 6).
-- This seed only establishes the category reference data required for all other data.
