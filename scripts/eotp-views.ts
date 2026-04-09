/**
 * Shared SQL for v_eotp_costs (used by seed-production and recreate-eotp-costs-view).
 * Depends on public.v_allocation_costs and table eotp_routing.
 *
 * Convention: eotp_routing rows should target EOTPs **other than** the product’s main SAP code
 * (exceptions only). The view still excludes `eotp = main_eotp` so mis-keyed rows do not appear
 * twice or distort the remainder.
 */

import type { PrismaClient } from "../src/generated/prisma/client";

export async function createEotpCostsView(prisma: PrismaClient): Promise<void> {
  console.log("Creating v_eotp_costs...");

  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_eotp_costs`);

  await prisma.$executeRawUnsafe(`
    CREATE VIEW v_eotp_costs AS
    WITH product_costs AS (
      SELECT
        p.id                   AS product_id,
        p.name                 AS product_name,
        p."sapEotpCode"        AS main_eotp,
        p."sapEotpName"        AS main_eotp_name,
        v.initiative_year      AS year,
        SUM(v.internal_cost)   AS internal_cost,
        SUM(v.external_cost)   AS external_cost,
        SUM(v.direct_cost)     AS direct_cost
      FROM allocation_entity p
      JOIN initiative i ON i."allocation_entity_id" = p.id
      JOIN v_allocation_costs v ON v.jira_key = i.id
      GROUP BY p.id, p.name, p."sapEotpCode", p."sapEotpName", v.initiative_year
    ),
    -- Per product × year: sum of exception routing only (main EOTP targets excluded — see file header).
    routed_non_main AS (
      SELECT
        er."allocation_entity_id" AS product_id,
        er.year,
        SUM(er."internalAmount") AS internal_routed,
        SUM(er."externalAmount") AS external_routed,
        SUM(er."directAmount") AS direct_routed
      FROM eotp_routing er
      JOIN product_costs pc ON pc.product_id = er."allocation_entity_id" AND pc.year = er.year
      WHERE er.eotp <> pc.main_eotp
      GROUP BY er."allocation_entity_id", er.year
    )
    -- Exception rows: one line per routing row (same filter as routed_non_main).
    SELECT
      pc.product_id,
      pc.product_name,
      pc.year,
      er.eotp,
      er."eopLabel" AS eop_label,
      false AS is_main_eotp,
      er."internalAmount" AS internal_cost,
      er."externalAmount" AS external_cost,
      er."directAmount" AS direct_cost,
      (er."externalAmount" + er."directAmount") AS cash_out,
      (er."internalAmount" + er."externalAmount" + er."directAmount") AS total_cost
    FROM eotp_routing er
    JOIN product_costs pc ON pc.product_id = er."allocation_entity_id" AND pc.year = er.year
    WHERE er.eotp <> pc.main_eotp

    UNION ALL

    -- Main bucket: product-year totals minus routed_non_main (one row per product × year).
    SELECT
      pc.product_id,
      pc.product_name,
      pc.year,
      pc.main_eotp AS eotp,
      pc.main_eotp_name AS eop_label,
      true AS is_main_eotp,
      pc.internal_cost - COALESCE(rnm.internal_routed, 0) AS internal_cost,
      pc.external_cost - COALESCE(rnm.external_routed, 0) AS external_cost,
      pc.direct_cost - COALESCE(rnm.direct_routed, 0) AS direct_cost,
      (pc.external_cost - COALESCE(rnm.external_routed, 0) + (pc.direct_cost - COALESCE(rnm.direct_routed, 0))) AS cash_out,
      (pc.internal_cost - COALESCE(rnm.internal_routed, 0) + (pc.external_cost - COALESCE(rnm.external_routed, 0)) + (pc.direct_cost - COALESCE(rnm.direct_routed, 0))) AS total_cost
    FROM product_costs pc
    LEFT JOIN routed_non_main rnm ON rnm.product_id = pc.product_id AND rnm.year = pc.year
  `);

  console.log("  ✓ v_eotp_costs created\n");
}
