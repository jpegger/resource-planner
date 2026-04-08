-- Recreate v_eotp_routing and v_eotp_costs after eotp_routing schema change.
-- Requires v_allocation_costs. If migrate fails here, run: npm run db:view:prod
-- (that creates v_allocation_costs first, then these views).
-- Note: v_eotp_routing is dropped again in 20260408150000_drop_v_eotp_routing_view.

DROP VIEW IF EXISTS v_eotp_routing;
DROP VIEW IF EXISTS v_eotp_costs;

CREATE VIEW v_eotp_costs AS
WITH product_costs AS (
  SELECT
    p.id                   AS product_id,
    p.name                 AS product_name,
    p."sapEotpCode"        AS main_eotp,
    v.initiative_year      AS year,
    SUM(v.internal_cost)   AS internal_cost,
    SUM(v.external_cost)   AS external_cost,
    SUM(v.direct_cost)     AS direct_cost
  FROM product p
  JOIN initiative i ON i."productId" = p.id
  JOIN v_allocation_costs v ON v.jira_key = i.id
  GROUP BY p.id, p.name, p."sapEotpCode", v.initiative_year
),
routing_amounts AS (
  SELECT
    er."productId"         AS product_id,
    er.year                AS year,
    er.eotp                AS eotp,
    er."eopLabel"          AS eop_label,
    er."internalAmount"    AS internal_routed,
    er."externalAmount"    AS external_routed,
    er."directAmount"      AS direct_routed
  FROM eotp_routing er
)
SELECT
  pc.product_id,
  pc.product_name,
  pc.year,
  ra.eotp,
  ra.eop_label,
  false AS is_main_eotp,
  ra.internal_routed AS internal_cost,
  ra.external_routed AS external_cost,
  ra.direct_routed AS direct_cost
FROM product_costs pc
JOIN routing_amounts ra
  ON ra.product_id = pc.product_id
 AND ra.year = pc.year
WHERE ra.eotp <> pc.main_eotp

UNION ALL

SELECT
  pc.product_id,
  pc.product_name,
  pc.year,
  pc.main_eotp AS eotp,
  pc.main_eotp AS eop_label,
  true AS is_main_eotp,
  pc.internal_cost - COALESCE(SUM(CASE WHEN ra.eotp <> pc.main_eotp THEN ra.internal_routed ELSE 0 END), 0) AS internal_cost,
  pc.external_cost - COALESCE(SUM(CASE WHEN ra.eotp <> pc.main_eotp THEN ra.external_routed ELSE 0 END), 0) AS external_cost,
  pc.direct_cost   - COALESCE(SUM(CASE WHEN ra.eotp <> pc.main_eotp THEN ra.direct_routed ELSE 0 END), 0) AS direct_cost
FROM product_costs pc
LEFT JOIN routing_amounts ra
  ON ra.product_id = pc.product_id
 AND ra.year = pc.year
GROUP BY
  pc.product_id,
  pc.product_name,
  pc.year,
  pc.main_eotp,
  pc.internal_cost,
  pc.external_cost,
  pc.direct_cost;

CREATE VIEW v_eotp_routing AS
WITH product_costs AS (
  SELECT
    p.id                   AS product_id,
    p.name                 AS product_name,
    v.initiative_year      AS year,
    SUM(v.internal_cost)   AS internal_cost,
    SUM(v.external_cost)   AS external_cost,
    SUM(v.direct_cost)     AS direct_cost
  FROM product p
  JOIN initiative i ON i."productId" = p.id
  JOIN v_allocation_costs v ON v.jira_key = i.id
  GROUP BY p.id, p.name, v.initiative_year
)
SELECT
  er.id,
  er."productId"                       AS product_id,
  pc.product_name                      AS product_name,
  er.year,
  er.eotp,
  er."eopLabel"                        AS eop_label,
  er."internalAmount"                  AS internal_amount,
  er."externalAmount"                  AS external_amount,
  er."directAmount"                    AS direct_amount,
  er.comment,
  pc.internal_cost                     AS total_internal_cost,
  pc.external_cost                     AS total_external_cost,
  pc.direct_cost                       AS total_direct_cost,
  er."internalAmount"                  AS routed_internal_cost,
  er."externalAmount"                  AS routed_external_cost,
  er."directAmount"                    AS routed_direct_cost,
  (er."internalAmount" + er."externalAmount" + er."directAmount") AS routed_total_cost,
  er."createdOn"                       AS created_on,
  er."modifiedOn"                      AS modified_on
FROM eotp_routing er
JOIN product_costs pc
  ON pc.product_id = er."productId"
 AND pc.year = er.year;
