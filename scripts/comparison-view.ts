import type { PrismaClient } from "../src/generated/prisma/client";

export async function createComparisonView(prisma: PrismaClient): Promise<void> {
  console.log("Creating v_comparison...");

  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_comparison`);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW v_comparison AS
    SELECT
      ed.sap_eotp_code AS eotp,
      ed.label,
      ed.division,
      ed.sub_division,
      ed.team,
      ed.budget_owner AS owner,
      sd.snapshot_id,
      sd.year,
      bd.baseline_id,
      COALESCE(SUM(sd.internal), 0)        AS snap_internal,
      COALESCE(SUM(sd.external), 0)        AS snap_external,
      COALESCE(SUM(sd.direct), 0)          AS snap_direct,
      COALESCE(SUM(sd.catchout), 0)        AS snap_catchout,
      COALESCE(SUM(bd.baseline_amount), 0) AS baseline_amount,
      COALESCE(SUM(bd.baseline_amount), 0) - COALESCE(SUM(sd.catchout), 0) AS gap
    FROM eotp_definition ed
    LEFT JOIN v_snapshot_detail sd ON sd.eotp = ed.sap_eotp_code
    LEFT JOIN v_baseline_detail bd
      ON bd.eotp = ed.sap_eotp_code
     AND bd.year = sd.year
    GROUP BY
      ed.sap_eotp_code, ed.label, ed.division, ed.sub_division, ed.team, ed.budget_owner,
      sd.snapshot_id, sd.year, bd.baseline_id
  `);

  console.log("  ✓ v_comparison created\n");
}

