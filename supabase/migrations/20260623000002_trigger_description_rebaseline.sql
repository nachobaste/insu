-- The traffic baseline changed from free-flow to typical rush hour; fix the copy.
-- The numeric threshold (50), metric, and operator are unchanged.
UPDATE contracts
SET trigger_condition = jsonb_set(
      trigger_condition,
      '{description}',
      '"Travel time at least 50% worse than a typical rush hour"'
    )
WHERE trigger_type = 'urban'
  AND trigger_condition->>'description' = 'Travel time at least 50% worse than normal';
