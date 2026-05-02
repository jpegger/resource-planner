import type { PrismaClient } from "../src/generated/prisma/client";

export async function createComparisonView(prisma: PrismaClient): Promise<void> {
  console.log("Creating v_comparison...");

  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_comparison`);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW v_comparison AS
    WITH
      snap AS (
        SELECT
          snapshot_id,
          year,
          eotp,
          SUM(internal) AS internal,
          SUM(external) AS external,
          SUM(direct)   AS direct,
          SUM(cash_out) AS cash_out
        FROM v_snapshot_detail
        GROUP BY snapshot_id, year, eotp
      ),
      base AS (
        SELECT
          baseline_id,
          year,
          eotp,
          SUM(baseline_amount) AS baseline_amount
        FROM v_baseline_detail
        GROUP BY baseline_id, year, eotp
      )
    SELECT
      ed.sap_eotp_code AS eotp,
      ed.label,
      ed.division,
      ed.sub_division,
      ed.team,
      ed.budget_owner AS owner,
      s.id AS snapshot_id,
      s.year AS year,
      b.id AS baseline_id,
      COALESCE(sn.internal, 0) AS snap_internal,
      COALESCE(sn.external, 0) AS snap_external,
      COALESCE(sn.direct, 0)   AS snap_direct,
      COALESCE(sn.cash_out, 0) AS snap_cash_out,
      COALESCE(ba.baseline_amount, 0) AS baseline_amount,
      COALESCE(ba.baseline_amount, 0) - COALESCE(sn.cash_out, 0) AS gap
    FROM allocation_snapshot s
    JOIN budget_baseline b
      ON b.year = s.year
    CROSS JOIN eotp_definition ed
    LEFT JOIN snap sn
      ON sn.snapshot_id = s.id
     AND sn.year = s.year
     AND sn.eotp = ed.sap_eotp_code
    LEFT JOIN base ba
      ON ba.baseline_id = b.id
     AND ba.year = b.year
     AND ba.eotp = ed.sap_eotp_code
  `);

  console.log("  ✓ v_comparison created\n");
}

