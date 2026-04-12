-- Allocation-entity rollup of internal / external / direct costs (depends on v_allocation_costs).
-- Skips creation if v_allocation_costs is missing (e.g. migrate before first seed run).

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.views
    WHERE table_schema = 'public'
      AND table_name = 'v_allocation_costs'
  ) THEN
    EXECUTE 'DROP VIEW IF EXISTS v_allocation_entity_cost_totals';
    EXECUTE $sql$
CREATE VIEW v_allocation_entity_cost_totals AS
SELECT
  i."allocation_entity_id" AS allocation_entity_id,
  COALESCE(SUM(v.internal_cost), 0)::double precision AS total_internal,
  COALESCE(SUM(v.external_cost), 0)::double precision AS total_external,
  COALESCE(SUM(v.direct_cost), 0)::double precision AS total_direct
FROM initiative i
LEFT JOIN v_allocation_costs v ON v.jira_key = i.id
WHERE i."allocation_entity_id" IS NOT NULL
GROUP BY i."allocation_entity_id"
$sql$;
  END IF;
END
$migration$;
