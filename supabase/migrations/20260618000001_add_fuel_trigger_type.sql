ALTER TABLE contracts
  DROP CONSTRAINT contracts_trigger_type_check;

ALTER TABLE contracts
  ADD CONSTRAINT contracts_trigger_type_check
  CHECK (trigger_type IN ('weather', 'urban', 'event', 'manual', 'fuel'));
