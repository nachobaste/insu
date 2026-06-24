-- In-app notifications for the coverage lifecycle.

CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type         text NOT NULL
                 CHECK (type IN ('coverage_paid','coverage_expired','protection_purchased','provider_settled')),
  title        text NOT NULL,
  body         text NOT NULL,
  contract_id  uuid REFERENCES contracts(id),
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_created_idx
  ON notifications (user_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own notifications select" ON notifications FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Own notifications update" ON notifications FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Insert own notifications" ON notifications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Per-user notification preferences. All types on by default.
ALTER TABLE profiles ADD COLUMN notification_prefs jsonb NOT NULL
  DEFAULT '{"coverage_paid":true,"coverage_expired":true,"protection_purchased":true,"provider_settled":true}'::jsonb;
