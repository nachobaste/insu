-- Self-tracked login counter for F&F engagement monitoring. Supabase's auth
-- audit log is not reachable via PostgREST and listUsers only exposes
-- last_sign_in_at, so we count logins ourselves from an app-level action.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Atomic increment, mirrors increment_tier_capacity/increment_contract_volume.
-- SECURITY DEFINER so it runs regardless of the caller's RLS on profiles.
CREATE OR REPLACE FUNCTION increment_login_count(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles
  SET login_count = login_count + 1,
      last_login_at = now()
  WHERE id = p_user_id;
$$;
