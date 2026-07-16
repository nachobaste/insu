-- Replace the login counter (20260715000001) with an engagement heartbeat.
-- Supabase sessions are long-lived, so explicit sign-ins are rare and a login
-- count barely moves for an active tester. Instead we track "last seen" and the
-- number of distinct days a user was active, stamped from the proxy on real
-- navigations. The login-tracking columns/RPC held no meaningful data.
DROP FUNCTION IF EXISTS increment_login_count(uuid);

ALTER TABLE profiles
  DROP COLUMN IF EXISTS login_count,
  DROP COLUMN IF EXISTS last_login_at,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS active_days integer NOT NULL DEFAULT 0;

-- Stamp last_seen_at = now() and increment active_days only when the previous
-- last_seen was on an earlier UTC day (so it counts distinct active days, and
-- is safe to call more than once per day). SECURITY DEFINER to bypass RLS.
CREATE OR REPLACE FUNCTION touch_last_seen(p_user_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles
  SET active_days = active_days + CASE
        WHEN last_seen_at IS NULL OR last_seen_at < date_trunc('day', now()) THEN 1
        ELSE 0
      END,
      last_seen_at = now()
  WHERE id = p_user_id;
$$;
