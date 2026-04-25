/**
 * Dev/test seed — imports the small dataset under `scripts/datasets/dev/`.
 *
 * Usage:
 *   npm run db:seed:dev
 *
 * Prerequisites:
 *   npm install --save-dev ts-node @types/node papaparse @types/papaparse
 *   npm install @prisma/client
 *   npx prisma migrate dev --name init
 *
 * Place your CSV files in scripts/datasets/dev/:
 *   Ressources.csv
 *   Rates.csv
 *   RateStandard.csv
 *   Initiatives.csv
 *   InitiativeRessourceAssignement.csv
 */

import "dotenv/config";
import { PrismaClient, ResourceType } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";

import { createEotpCostsView } from "./eotp-views";
import { createComparisonView } from "./comparison-view";
import { createSnapshotBaselineViews } from "./snapshot-baseline-views";
import {
  CREATE_V_ALLOCATION_ENTITY_COST_TOTALS_VIEW,
  DROP_V_ALLOCATION_ENTITY_COST_TOTALS_VIEW,
} from "./v-allocation-entity-cost-totals-view";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

const DATA_DIR = path.join(__dirname, "datasets", "dev");

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeHeaderKey(key: string): string {
  return key.replace(/^\uFEFF/, "").trim();
}

function readCsv(filename: string): Record<string, string>[] {
  const content = fs.readFileSync(path.join(DATA_DIR, filename), "utf-8");
  const result = Papa.parse(content, { header: true, skipEmptyLines: true });
  const rows = result.data as Record<string, string>[];
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      out[normalizeHeaderKey(k)] = v;
    }
    return out;
  });
}

function parseDate(value: string): Date | null {
  if (!value || value.trim() === "") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function parseFloat_(value: string): number | null {
  if (!value || value.trim() === "") return null;
  const n = parseFloat(value);
  return isNaN(n) ? null : n;
}

function parseResourceType(raw: string): ResourceType | null {
  const map: Record<string, ResourceType> = {
    internal: ResourceType.INTERNAL,
    external: ResourceType.EXTERNAL,
    "direct costs": ResourceType.DIRECT_COST,
  };
  return map[raw?.toLowerCase()?.trim()] ?? null;
}

// ─── 1. Resources ────────────────────────────────────────────────────────────

async function seedResources() {
  console.log("Seeding resources...");
  const rows = readCsv("Ressources.csv");

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const type = parseResourceType(row["isInternalOrExternal"]);
    if (!type) {
      // Skip dirty rows (JJ, ss, qsd, etc.)
      console.warn(`  ⚠ Skipping resource ${row["RessourcePrimaryId"]} — unknown type: "${row["isInternalOrExternal"]}"`);
      skipped++;
      continue;
    }

    const createdOn = parseDate(row["Created On"]);
    const modifiedOn = parseDate(row["Modified On"]);
    if (!createdOn || !modifiedOn) {
      console.warn(`  ⚠ Skipping resource ${row["RessourcePrimaryId"]} — invalid dates`);
      skipped++;
      continue;
    }

    await prisma.resource.upsert({
      where: { id: row["RessourcePrimaryId"] },
      update: {
        fullName: row["FullName"],
        firstName: row["FirstName"] || null,
        lastName: row["LastName"] || null,
        function: row["Function"] || null,
        cellule: row["Cellule"] || null,
        direction: row["Direction"] || null,
        type,
        modifiedOn,
      },
      create: {
        id: row["RessourcePrimaryId"],
        fullName: row["FullName"],
        firstName: row["FirstName"] || null,
        lastName: row["LastName"] || null,
        function: row["Function"] || null,
        cellule: row["Cellule"] || null,
        direction: row["Direction"] || null,
        type,
        createdOn,
        modifiedOn,
      },
    });
    inserted++;
  }

  console.log(`  ✓ Resources: ${inserted} upserted, ${skipped} skipped\n`);
}

// ─── 2. Individual Rates ─────────────────────────────────────────────────────

async function seedRates() {
  console.log("Seeding individual rates...");
  const rows = readCsv("Rates.csv");

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    // Skip orphaned rows (no resourceId)
    if (!row["RessourceId"] || row["RessourceId"].trim() === "") {
      skipped++;
      continue;
    }
    // Skip rows with no daily rate
    const dailyRate = parseFloat_(row["DailyRate"]);
    if (dailyRate === null) {
      skipped++;
      continue;
    }

    const nbrDaysPerYear = parseFloat_(row["nbrOfDaysPerYearDecimal"]);
    if (nbrDaysPerYear === null || Number.isNaN(nbrDaysPerYear)) {
      skipped++;
      continue;
    }

    const year = parseInt(row["Year"]);
    if (isNaN(year)) { skipped++; continue; }

    const createdOn = parseDate(row["Created On"]);
    const modifiedOn = parseDate(row["Modified On"]);
    if (!createdOn || !modifiedOn) { skipped++; continue; }

    // Check resource exists (may have been skipped above due to bad type)
    const resource = await prisma.resource.findUnique({
      where: { id: row["RessourceId"] },
      select: { id: true },
    });
    if (!resource) { skipped++; continue; }

    await prisma.rate.upsert({
      where: { resourceId_year: { resourceId: row["RessourceId"], year } },
      update: { dailyRate, nbrDaysPerYear, modifiedOn },
      create: {
        id: row["RatePrimaryId"],
        resourceId: row["RessourceId"],
        year,
        dailyRate,
        nbrDaysPerYear,
        createdOn,
        modifiedOn,
      },
    });
    inserted++;
  }

  console.log(`  ✓ Individual rates: ${inserted} upserted, ${skipped} skipped\n`);
}

// ─── 3. Standard Rates ───────────────────────────────────────────────────────

async function seedRateStandards() {
  console.log("Seeding standard rates...");
  const rows = readCsv("RateStandard.csv");

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const type = parseResourceType(row["IsInternalOrExternal"]);
    if (!type || type === ResourceType.DIRECT_COST) {
      skipped++;
      continue;
    }

    const year = parseInt(row["Year"]);
    const dailyRate = parseFloat_(row["DailyRate"]);
    const nbrDaysPerYear = parseInt(row["NbrOfDaysPerYear"]);
    if (isNaN(year) || dailyRate === null || isNaN(nbrDaysPerYear)) { skipped++; continue; }

    const createdOn = parseDate(row["Created On"]);
    const modifiedOn = parseDate(row["Modified On"]);
    if (!createdOn || !modifiedOn) { skipped++; continue; }

    await prisma.rateStandard.upsert({
      where: { year_type: { year, type } },
      update: { dailyRate, nbrDaysPerYear, modifiedOn },
      create: {
        id: row["RateStandardPrimaryId"],
        year,
        type,
        dailyRate,
        nbrDaysPerYear,
        createdOn,
        modifiedOn,
      },
    });
    inserted++;
  }

  console.log(`  ✓ Standard rates: ${inserted} upserted, ${skipped} skipped\n`);
}

// ─── 4. Initiatives ──────────────────────────────────────────────────────────

async function seedInitiatives() {
  console.log("Seeding initiatives...");
  const rows = readCsv("Initiatives.csv");

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const jiraKey = row["jira_key"];
    if (!jiraKey) { skipped++; continue; }

    const year = parseInt(row["year"]);
    if (isNaN(year)) { skipped++; continue; }

    const createdOn = parseDate(row["Created On"]);
    const modifiedOn = parseDate(row["Modified On"]);
    if (!createdOn || !modifiedOn) { skipped++; continue; }

    const powerId = row["PowerId"]?.trim() || null;

    await prisma.initiative.upsert({
      where: { id: jiraKey },
      update: {
        powerId,
        summary: row["summary"] || "",
        status: row["status"] || "",
        year,
        components: row["components"] || null,
        productGroup: row["productGroup"] || null,
        initiativeType: row["initiativeType"] || null,
        modifiedOn,
      },
      create: {
        id: jiraKey,
        powerId,
        summary: row["summary"] || "",
        status: row["status"] || "",
        year,
        components: row["components"] || null,
        productGroup: row["productGroup"] || null,
        initiativeType: row["initiativeType"] || null,
        createdOn,
        modifiedOn,
      },
    });
    inserted++;
  }

  console.log(`  ✓ Initiatives: ${inserted} upserted, ${skipped} skipped\n`);
}

// ─── 5. Allocations ──────────────────────────────────────────────────────────

async function seedAllocations() {
  console.log("Seeding allocations...");
  const rows = readCsv("InitiativeRessourceAssignement.csv");

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = row["PowerId"];
    const initiativeId = row["InitiativeId"];
    const resourceId = row["RessourceId"];

    if (!id || !initiativeId || !resourceId) { skipped++; continue; }

    // Verify FK existence
    const [initiative, resource] = await Promise.all([
      prisma.initiative.findUnique({ where: { id: initiativeId }, select: { id: true } }),
      prisma.resource.findUnique({ where: { id: resourceId }, select: { id: true } }),
    ]);
    if (!initiative || !resource) { skipped++; continue; }

    const createdOn = parseDate(row["Created On"]);
    const modifiedOn = parseDate(row["Modified On"]);
    if (!createdOn || !modifiedOn) { skipped++; continue; }

    const manDaysRaw = parseFloat_(row["ManDaysAssignement"]);
    const quantityRaw = parseFloat_(row["PercentAssignement"]);

    // Normalise: store 0 as null to keep fields clean
    const manDays = manDaysRaw && manDaysRaw > 0 ? manDaysRaw : null;
    const quantity = quantityRaw && quantityRaw > 0 ? quantityRaw : null;

    await prisma.allocation.upsert({
      where: { id },
      update: { manDays, quantity, modifiedOn },
      create: {
        id,
        externalId: row["InitiativeRessourceAssignementExternalId"] || null,
        initiativeId,
        resourceId,
        manDays,
        quantity,
        createdOn,
        modifiedOn,
      },
    });
    inserted++;
  }

  console.log(`  ✓ Allocations: ${inserted} upserted, ${skipped} skipped\n`);
}

// ─── 6. Cost View ────────────────────────────────────────────────────────────
// Run after all tables are seeded. This view is what Power BI connects to.

async function createAllocationEntityCostTotalsView() {
  console.log("Creating v_allocation_entity_cost_totals view...");
  await prisma.$executeRawUnsafe(DROP_V_ALLOCATION_ENTITY_COST_TOTALS_VIEW);
  await prisma.$executeRawUnsafe(CREATE_V_ALLOCATION_ENTITY_COST_TOTALS_VIEW);
  console.log("  ✓ View v_allocation_entity_cost_totals created\n");
}

async function createCostView() {
  console.log("Creating v_allocation_costs view...");

  // Drop dependents first (v_eotp_costs / totals reference v_allocation_costs).
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_eotp_routing`);
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_eotp_costs`);
  await prisma.$executeRawUnsafe(DROP_V_ALLOCATION_ENTITY_COST_TOTALS_VIEW);
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_allocation_costs CASCADE`);

  // Column names match Prisma’s migration (camelCase quoted identifiers).
  await prisma.$executeRawUnsafe(`
    CREATE VIEW v_allocation_costs AS
SELECT
  a.id                                            AS allocation_id,
  i.id                                            AS jira_key,
  i."powerId"                                     AS power_id,
  i.summary,
  i.year                                          AS initiative_year,
  i.components                                    AS jira_component_product,
  i."initiativeType"                              AS initiative_type,
  i.status,
  r.id                                            AS resource_id,
  r."fullName"                                    AS resource_name,
  r.type                                          AS resource_type,
  r.cellule,
  r.direction,
  a.quantity,
  COALESCE(rt."dailyRate", rs."dailyRate")        AS effective_rate,
  COALESCE(
    CAST(rt."nbrDaysPerYear" AS double precision),
    CAST(rs."nbrDaysPerYear" AS double precision)
  )                                               AS effective_days_per_year,

  -- Internal/External: man-days or FTE×days/year. Direct: man-days or quantity×days/year.
  CASE
    WHEN r.type = 'DIRECT_COST' THEN
      CASE
        WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN CAST(a."manDays" AS double precision)
        WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity * COALESCE(
            CAST(rt."nbrDaysPerYear" AS double precision),
            CAST(rs."nbrDaysPerYear" AS double precision)
          )
        ELSE 0
      END
    WHEN r.type IN ('INTERNAL', 'EXTERNAL') AND a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
      a."manDays"
    WHEN r.type IN ('INTERNAL', 'EXTERNAL') AND a.quantity IS NOT NULL AND a.quantity > 0 THEN
      a.quantity * COALESCE(
        CAST(rt."nbrDaysPerYear" AS double precision),
        CAST(rs."nbrDaysPerYear" AS double precision)
      )
    ELSE 0
  END                                             AS calculated_man_days,

  -- Raw computed cost. DIRECT_COST: man_days×rate OR quantity×days/year×rate
  CASE
    WHEN r.type = 'DIRECT_COST' THEN
      CASE
        WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays" * COALESCE(rt."dailyRate", CAST(0 AS double precision))
        WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity
          * COALESCE(
            CAST(rt."nbrDaysPerYear" AS double precision),
            CAST(rs."nbrDaysPerYear" AS double precision)
          )
          * COALESCE(rt."dailyRate", CAST(0 AS double precision))
        ELSE CAST(0 AS double precision)
      END
    WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
      a."manDays" * COALESCE(rt."dailyRate", rs."dailyRate")
    WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
      a.quantity
      * COALESCE(
        CAST(rt."nbrDaysPerYear" AS double precision),
        CAST(rs."nbrDaysPerYear" AS double precision)
      )
      * COALESCE(rt."dailyRate", rs."dailyRate")
    ELSE 0
  END                                             AS computed_cost,

  -- Internal cost (only when resource is INTERNAL)
  CASE
    WHEN r.type = 'INTERNAL' AND a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
      a."manDays" * COALESCE(rt."dailyRate", rs."dailyRate")
    WHEN r.type = 'INTERNAL' AND a.quantity IS NOT NULL AND a.quantity > 0 THEN
      a.quantity
      * COALESCE(
        CAST(rt."nbrDaysPerYear" AS double precision),
        CAST(rs."nbrDaysPerYear" AS double precision)
      )
      * COALESCE(rt."dailyRate", rs."dailyRate")
    ELSE 0
  END                                             AS internal_cost,

  -- External cost (only when resource is EXTERNAL)
  CASE
    WHEN r.type = 'EXTERNAL' AND a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
      a."manDays" * COALESCE(rt."dailyRate", rs."dailyRate")
    WHEN r.type = 'EXTERNAL' AND a.quantity IS NOT NULL AND a.quantity > 0 THEN
      a.quantity
      * COALESCE(
        CAST(rt."nbrDaysPerYear" AS double precision),
        CAST(rs."nbrDaysPerYear" AS double precision)
      )
      * COALESCE(rt."dailyRate", rs."dailyRate")
    ELSE 0
  END                                             AS external_cost,

  -- Direct cost (only when resource is DIRECT_COST)
  CASE
    WHEN r.type = 'DIRECT_COST' THEN
      CASE
        WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays" * COALESCE(rt."dailyRate", CAST(0 AS double precision))
        WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity
          * COALESCE(
            CAST(rt."nbrDaysPerYear" AS double precision),
            CAST(rs."nbrDaysPerYear" AS double precision)
          )
          * COALESCE(rt."dailyRate", CAST(0 AS double precision))
        ELSE CAST(0 AS double precision)
      END
    ELSE 0
  END                                             AS direct_cost,
    -- FTE % only for Internal and External resources
  -- quantity is stored as decimal (0.5 = 50%, 1.2 = 120%)
  CASE
    WHEN r.type IN ('INTERNAL', 'EXTERNAL')
     AND a.quantity IS NOT NULL
     AND a."manDays" IS NULL OR a."manDays" = 0
    THEN a.quantity
    ELSE 0
  END                                             AS fte_decimal,

  -- Same expressed as a percentage (0.5 → 50)
  CASE
    WHEN r.type IN ('INTERNAL', 'EXTERNAL')
     AND a.quantity IS NOT NULL
     AND a."manDays" IS NULL OR a."manDays" = 0
    THEN a.quantity * 100
    ELSE 0
  END                                             AS fte_percent

  

FROM allocation a
JOIN initiative i
  ON i.id = a."initiativeId"
JOIN resource r
  ON r.id = a."resourceId"
LEFT JOIN rate rt
  ON rt."resourceId" = r.id
 AND rt.year = i.year
LEFT JOIN rate_standard rs
  ON rs.year = i.year
 AND rs.type = r.type
 AND r.type <> 'DIRECT_COST'
`);

  console.log("  ✓ View v_allocation_costs created\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const viewOnly =
    process.env["SEED_VIEW_ONLY"] === "1" ||
    process.env["SEED_VIEW_ONLY"] === "true";

  if (viewOnly) {
    console.log("SEED_VIEW_ONLY: recreating v_allocation_costs (no CSV import)…\n");
    await createCostView();
    await createAllocationEntityCostTotalsView();
    await createEotpCostsView(prisma);
    await createSnapshotBaselineViews(prisma);
    await createComparisonView(prisma);
    console.log("✅ View updated.");
    return;
  }

  console.log("🌱 Starting seed...\n");

  // Order matters — respect FK dependencies
  await seedResources();
  await seedRates();
  await seedRateStandards();
  await seedInitiatives();
  await seedAllocations();
  await createCostView();
  await createAllocationEntityCostTotalsView();
  await createEotpCostsView(prisma);
  await createSnapshotBaselineViews(prisma);
  await createComparisonView(prisma);

  console.log("✅ Seed complete.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
