-- Fix rows from seed migration that already had { "operator": ">" } (symbol, not canonical).
-- These were skipped by the previous migration that only matched the 'comparator' key.
UPDATE contracts
SET trigger_condition = jsonb_set(
  trigger_condition,
  '{operator}',
  CASE trigger_condition->>'operator'
    WHEN '>'  THEN '"gt"'
    WHEN '>=' THEN '"gte"'
    WHEN '<'  THEN '"lt"'
    WHEN '<=' THEN '"lte"'
    WHEN '='  THEN '"gte"'
  END::jsonb
)
WHERE trigger_condition->>'operator' IN ('>', '>=', '<', '<=', '=')
  AND trigger_type IN ('weather', 'urban');
