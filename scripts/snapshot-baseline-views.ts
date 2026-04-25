import type { PrismaClient } from "../src/generated/prisma/client";

/** Frozen snapshot rows vs baseline import (depends on allocation_snapshot / budget_baseline tables). */
export async function createSnapshotBaselineViews(prisma: PrismaClient): Promise<void> {
  console.log("Creating v_snapshot_detail, v_baseline_detail, v_snapshot_eotp_year…");
  // These views are referenced by reporting views (e.g. v_comparison). Use CASCADE to keep
  // seed runs idempotent when dependencies already exist.
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_comparison CASCADE`);
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_snapshot_eotp_year CASCADE`);
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_snapshot_detail CASCADE`);
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_baseline_detail CASCADE`);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW v_snapshot_detail AS
    SELECT
      s.id AS snapshot_id,
      s.name AS snapshot_name,
      s."takenAt" AS snapshot_date,
      s.year AS year,
      r.eotp AS eotp,
      r."eopLabel" AS eop_label,
      r."productId" AS product_id,
      r."productName" AS product_name,
      COALESCE(ae."productFamily", ed.division, 'Unassigned') AS product_family,
      COALESCE(ae."division", ed.division, 'Unassigned') AS division,
      COALESCE(ae."subDivision", ed.sub_division, 'Unassigned') AS sub_division,
      ae."team" AS team,
      COALESCE(ed.budget_owner, 'Unassigned') AS budget_owner,
      COALESCE(ed.director, 'Unassigned') AS director,
      r.internal AS internal,
      r.external AS external,
      r.direct AS direct,
      CAST(r.external AS double precision) + CAST(r.direct AS double precision) AS catchout
    FROM allocation_snapshot s
    JOIN allocation_snapshot_row r ON r."snapshotId" = s.id
    LEFT JOIN allocation_entity ae ON ae.id = r."productId"
    LEFT JOIN eotp_definition ed ON ed.sap_eotp_code = r.eotp
  `);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW v_baseline_detail AS
    SELECT
      b.id AS baseline_id,
      b.name AS baseline_name,
      b.version AS baseline_version,
      b."importedAt" AS imported_at,
      b.year AS year,
      bl.eotp AS eotp,
      bl."eopLabel" AS eop_label,
      CAST(NULL AS text) AS product_id,
      CAST(NULL AS text) AS product_name,
      CAST(NULL AS text) AS product_family,
      CAST(NULL AS text) AS division,
      CAST(NULL AS text) AS sub_division,
      CAST(NULL AS text) AS team,
      CAST(NULL AS text) AS budget_owner,
      CAST(NULL AS text) AS director,
      bl.cellule AS cellule,
      bl.amount AS baseline_amount
    FROM budget_baseline b
    JOIN budget_baseline_row bl ON bl."baselineId" = b.id
  `);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE VIEW v_snapshot_eotp_year AS
    SELECT
      s.id AS snapshot_id,
      s.name AS snapshot_name,
      s."takenAt" AS snapshot_date,
      s.year AS year,
      r.eotp AS eotp,
      MAX(r."eopLabel") AS eop_label,
      SUM(r.internal) AS internal,
      SUM(r.external) AS external,
      SUM(r.direct) AS direct,
      SUM(CAST(r.external AS double precision) + CAST(r.direct AS double precision)) AS catchout
    FROM allocation_snapshot s
    JOIN allocation_snapshot_row r ON r."snapshotId" = s.id
    GROUP BY s.id, s.name, s."takenAt", s.year, r.eotp
  `);

  console.log("  ✓ v_snapshot_detail, v_baseline_detail, v_snapshot_eotp_year created\n");
}

