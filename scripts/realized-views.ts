/**
 * Realized layer reporting views (timesheets + VIM + AR + client revenue).
 * Does not alter v_allocation_costs or v_eotp_costs.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import { Prisma } from "../src/generated/prisma/client";

export async function createRealizedViews(prisma: PrismaClient): Promise<void> {
  console.log("Creating v_realized_costs, v_planned_revenue, v_realized_revenue…");

  await prisma.$executeRaw(Prisma.sql`
    CREATE OR REPLACE VIEW v_realized_costs AS
    SELECT
      te.year,
      te.month,
      CAST('INTERNAL' AS TEXT) AS cost_type,
      te.allocation_entity_id,
      ae."name" AS product_name,
      ae."sapEotpCode" AS eotp,
      CAST(NULL AS TEXT) AS division,
      CAST(NULL AS TEXT) AS sub_division,
      CAST(NULL AS TEXT) AS team,
      CAST(NULL AS TEXT) AS owner,
      te.initiative_id,
      te.resource_id,
      te.sn_programme_name,
      te.sn_project_nr,
      te.sn_project_label,
      (CAST(te.hours AS double precision) / 8.0)
        * COALESCE(r."dailyRate", rs."dailyRate") AS amount_eur,
      te.hours,
      te.import_warning
    FROM timesheet_entry te
    LEFT JOIN allocation_entity ae ON ae.id = te.allocation_entity_id
    LEFT JOIN rate r ON r."resourceId" = te.resource_id AND r."year" = te.year
    LEFT JOIN rate_standard rs
      ON rs."year" = te.year
     AND rs."type" = CAST('INTERNAL' AS "ResourceType")
    UNION ALL
    SELECT
      ie.year,
      ie.month,
      ie.cost_type,
      CAST(NULL AS TEXT) AS allocation_entity_id,
      CAST(NULL AS TEXT) AS product_name,
      ie.eotp_full_path AS eotp,
      ed.division,
      ed.sub_division,
      ed.team,
      ed.budget_owner AS owner,
      CAST(NULL AS TEXT) AS initiative_id,
      CAST(NULL AS TEXT) AS resource_id,
      CAST(NULL AS TEXT) AS sn_programme_name,
      CAST(NULL AS TEXT) AS sn_project_nr,
      ie.vendor_name AS sn_project_label,
      CAST(ie.amount_eur AS double precision) AS amount_eur,
      CAST(NULL AS numeric) AS hours,
      ie.import_warning
    FROM invoice_entry ie
    LEFT JOIN eotp_definition ed ON ed.id = ie.eotp_definition_id
  `);

  await prisma.$executeRaw(Prisma.sql`
    CREATE OR REPLACE VIEW v_planned_revenue AS
    SELECT
      ar.year,
      ar.allocation_entity_id,
      ae."name" AS product_name,
      ae."sapEotpCode" AS eotp,
      MAX(CAST(NULL AS TEXT)) AS activity_sector,
      ar.sf_product_name,
      ar.client_name,
      SUM(CAST(ar.amount_eur AS double precision)) AS amount_eur,
      COUNT(*)::bigint AS line_count
    FROM ar_entry ar
    LEFT JOIN allocation_entity ae ON ae.id = ar.allocation_entity_id
    GROUP BY ar.year, ar.allocation_entity_id, ae."name", ae."sapEotpCode",
      ar.sf_product_name, ar.client_name
  `);

  await prisma.$executeRaw(Prisma.sql`
    CREATE OR REPLACE VIEW v_realized_revenue AS
    SELECT
      re.year,
      re.month,
      re.allocation_entity_id,
      ae."name" AS product_name,
      ae."sapEotpCode" AS eotp,
      re.sap_article_code,
      re.product_label,
      re.client_name,
      SUM(CAST(re.amount_eur AS double precision)) AS amount_eur,
      COUNT(*)::bigint AS invoice_count
    FROM revenue_entry re
    LEFT JOIN allocation_entity ae ON ae.id = re.allocation_entity_id
    GROUP BY re.year, re.month, re.allocation_entity_id, ae."name", ae."sapEotpCode",
      re.sap_article_code, re.product_label, re.client_name
  `);

  console.log("  ✓ v_realized_costs, v_planned_revenue, v_realized_revenue created\n");
}
