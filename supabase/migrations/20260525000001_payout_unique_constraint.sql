-- Prevent double-payout: a position can only ever have one payout row.
ALTER TABLE payouts
  ADD CONSTRAINT payouts_hedger_position_id_unique
  UNIQUE (hedger_position_id);
