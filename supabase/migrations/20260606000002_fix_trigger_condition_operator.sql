-- Convert stored trigger_condition from { comparator: '>'/'<'/'=' } to { operator: 'gt'/'lt'/'gte' }
-- to match the interface expected by lib/oracle/trigger.ts evaluateTrigger()
UPDATE contracts
SET trigger_condition = (trigger_condition - 'comparator') ||
  jsonb_build_object('operator',
    CASE trigger_condition->>'comparator'
      WHEN '>'  THEN 'gt'
      WHEN '>=' THEN 'gte'
      WHEN '<'  THEN 'lt'
      WHEN '<=' THEN 'lte'
      WHEN '='  THEN 'gte'
      ELSE 'gt'
    END
  )
WHERE trigger_condition ? 'comparator'
  AND trigger_type IN ('weather', 'urban');
