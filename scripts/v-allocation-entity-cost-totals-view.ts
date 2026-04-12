/**
 * v_allocation_entity_cost_totals — INT/EXT/DIR sums per allocation entity (from v_allocation_costs).
 * Must run after v_allocation_costs exists.
 */

export const DROP_V_ALLOCATION_ENTITY_COST_TOTALS_VIEW = `DROP VIEW IF EXISTS v_allocation_entity_cost_totals`;

/** CREATE VIEW body only (no DROP). */
export const CREATE_V_ALLOCATION_ENTITY_COST_TOTALS_VIEW = `
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
`;
