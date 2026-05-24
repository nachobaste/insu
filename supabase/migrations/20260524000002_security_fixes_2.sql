-- ─── PREVENT PROFILE ROLE SELF-ELEVATION ────────────────────────────────────
-- Replaces the open "Own profile update" policy with one that locks the role
-- field — only service role (admin actions) can change a user's role.
DROP POLICY IF EXISTS "Own profile update" ON profiles;

CREATE POLICY "Own profile update" ON profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND role = (SELECT role FROM profiles WHERE id = auth.uid())
  );

-- ─── ADMIN AUDIT LOG TABLE ───────────────────────────────────────────────────
-- Referenced in lib/actions/admin.ts but missing from migrations.
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    uuid NOT NULL REFERENCES profiles(id),
  action      text NOT NULL,
  contract_id uuid REFERENCES contracts(id),
  reason      text,
  metadata    jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_admin    ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_contract ON admin_audit_log(contract_id);

ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins can read all audit log entries; nobody can insert/update/delete via user context.
CREATE POLICY "Admins read audit log" ON admin_audit_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );
