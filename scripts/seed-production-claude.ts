/**
 * Production Seed Script — uses ID fields for all linking
 *
 * Sources (place in scripts/data-prod/):
 *   JIRA.csv          — latin-1, header row 0
 *   RESSOURCES.csv    — latin-1, header row 0
 *   RATES.csv         — utf-8-sig (BOM), header row 0
 *   Assignement.csv   — utf-8-sig (BOM), header row 0
 *
 * Key data quirks handled:
 *   - RESSOURCES: only 613 of 1721 rows have an ID — rest are blank rows, skipped
 *   - RATES: Swiss number format (1'100.000000) stripped before parsing
 *   - RATES: 12 rows with null RessourceId — skipped
 *   - Assignement: both Percent and ManDays columns carry a trailing % sign — stripped
 *   - Assignement: ManDays values are actual day counts (not percentages despite the % sign)
 *   - Assignement: Percent values are 0-100 scale — converted to 0-1 decimal for DB
 *   - Assignement: duplicate (resourceId + initiativeId) CSV rows merged — % and man-days summed
 *   - Assignement: if DB already has that pair, CSV values are added to existing quantity % and man-days
 *   - Assignement: 1 dirty row with '-' as resourceId — skipped
 *   - Assignement: IDs in all ID columns have leading/trailing whitespace — trimmed
 *
 * Add to package.json:
 *   "db:seed:prod": "tsx scripts/seed-production.ts"
 *
 * Run:
 *   npm run db:seed:prod
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient, ResourceType } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });
const DATA_DIR = path.join(__dirname, "data-prod");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readCsv(filename: string, encoding: "latin1" | "utf8"): Record<string, string>[] {
  const content = fs.readFileSync(path.join(DATA_DIR, filename), { encoding });
  // Strip BOM if present
  const cleaned = content.replace(/^\uFEFF/, "");
  const result = Papa.parse(cleaned, { header: true, skipEmptyLines: true });
  return result.data as Record<string, string>[];
}

/** Strip Swiss apostrophe thousands separator and trailing % or spaces, then parse float */
function parseNum(value: string | undefined): number | null {
  if (!value || value.trim() === "" || value.trim() === "-") return null;
  const cleaned = value
    .replace(/'/g, "")   // 1'100 → 1100
    .replace(/%/g, "")   // trailing % on both columns
    .replace(/\s/g, "")
    .trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseResourceType(raw: string | undefined): ResourceType | null {
  const map: Record<string, ResourceType> = {
    "internal":      ResourceType.INTERNAL,
    "external":      ResourceType.EXTERNAL,
    "direct costs":  ResourceType.DIRECT_COST,
  };
  return map[(raw ?? "").toLowerCase().trim()] ?? null;
}

const NOW = new Date();

/** One allocation per (resourceId, initiativeId); matches seed-production.ts. */
function allocationIdFromPair(resourceId: string, initiativeId: string): string {
  const h = createHash("sha256")
    .update(`${resourceId}|${initiativeId}`, "utf8")
    .digest("hex");
  return `ASS-${h.slice(0, 32)}`;
}

// ─── 1. Initiatives ──────────────────────────────────────────────────────────

async function seedInitiatives(): Promise<void> {
  console.log("Seeding initiatives from JIRA.csv...");
  const rows = readCsv("JIRA.csv", "latin1");

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = row["Key"]?.trim();
    if (!id) { skipped++; continue; }

    const year = parseInt(row["(RI) Year"]);
    if (isNaN(year)) { skipped++; continue; }

    await prisma.initiative.upsert({
      where: { id },
      update: {
        summary:        row["Summary"]?.trim() ?? "",
        status:         row["Status"]?.trim() ?? "",
        year,
        components:     row["Components"]?.trim() || null,
        productGroup:   row["(RI) Product Group"]?.trim() || null,
        initiativeType: row["(RI) Type"]?.trim() || null,
        modifiedOn:     NOW,
      },
      create: {
        id,
        powerId:        null,
        summary:        row["Summary"]?.trim() ?? "",
        status:         row["Status"]?.trim() ?? "",
        year,
        components:     row["Components"]?.trim() || null,
        productGroup:   row["(RI) Product Group"]?.trim() || null,
        initiativeType: row["(RI) Type"]?.trim() || null,
        createdOn:      NOW,
        modifiedOn:     NOW,
      },
    });
    upserted++;
  }

  console.log(`  ✓ Initiatives: ${upserted} upserted, ${skipped} skipped\n`);
}

// ─── 2. Resources ────────────────────────────────────────────────────────────

async function seedResources(): Promise<void> {
  console.log("Seeding resources from RESSOURCES.csv...");
  const rows = readCsv("RESSOURCES.csv", "latin1");

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    // Only rows with an ID are real resources — 1108 blank rows skipped here
    const id = row["ID"]?.trim();
    if (!id || id === "ID") { skipped++; continue; }

    const type = parseResourceType(row["Internal or External"]);
    if (!type) {
      console.warn(`  ⚠ Skipping ${id} — unknown type: "${row["Internal or External"]}"`);
      skipped++;
      continue;
    }

    const fullName = row["Full Name"]?.trim() || row["Nom"]?.trim() || "";
    if (!fullName) { skipped++; continue; }

    await prisma.resource.upsert({
      where: { id },
      update: {
        fullName,
        firstName:  row["Prénom"]?.trim() || null,
        lastName:   row["Nom"]?.trim() || null,
        function:   row["Fonction"]?.trim() || null,
        cellule:    row["Cellule"]?.trim() || null,
        direction:  row["Pôle"]?.trim() || null,
        type,
        modifiedOn: NOW,
      },
      create: {
        id,
        fullName,
        firstName:  row["Prénom"]?.trim() || null,
        lastName:   row["Nom"]?.trim() || null,
        function:   row["Fonction"]?.trim() || null,
        cellule:    row["Cellule"]?.trim() || null,
        direction:  row["Pôle"]?.trim() || null,
        type,
        createdOn:  NOW,
        modifiedOn: NOW,
      },
    });
    upserted++;
  }

  console.log(`  ✓ Resources: ${upserted} upserted, ${skipped} skipped (${skipped - upserted < 0 ? 0 : skipped} blank rows)\n`);
}

// ─── Add this function to seed-production.ts ─────────────────────────────────
// Place it between seedResources() and seedRates()
// Also add "RateStandard.csv" to the required files check in main()
// And call it in main(): await seedRateStandard();

async function seedRateStandard(): Promise<void> {
  console.log("Seeding standard rates from RateStandard.csv...");
  const rows = readCsv("RateStandard.csv", "utf8");  // utf-8-sig, BOM stripped by readCsv

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const id   = row["RateStandardPrimaryId"]?.trim();
    const year = parseInt(row["Year"]);
    const dailyRate     = parseNum(row["DailyRate"]);
    const nbrDaysPerYear = parseInt(row["NbrOfDaysPerYear"]);

    if (!id || isNaN(year) || dailyRate === null || isNaN(nbrDaysPerYear)) {
      skipped++;
      continue;
    }

    const rawType = row["IsInternalOrExternal"]?.trim();
    const type = parseResourceType(rawType);
    if (!type || type === ResourceType.DIRECT_COST) {
      // Standard rates only exist for INTERNAL and EXTERNAL
      skipped++;
      continue;
    }

    await prisma.rateStandard.upsert({
      where: { year_type: { year, type } },
      update: { dailyRate, nbrDaysPerYear, modifiedOn: NOW },
      create: {
        id,
        year,
        type,
        dailyRate,
        nbrDaysPerYear,
        createdOn:  new Date(row["Created On"]),
        modifiedOn: new Date(row["Modified On"]),
      },
    });
    upserted++;
  }

  console.log(`  ✓ Standard rates: ${upserted} upserted, ${skipped} skipped\n`);
}

// ─── Updated main() call order ────────────────────────────────────────────────
// async function main() {
//   ...truncate tables...
//   await seedInitiatives();
//   await seedResources();
//   await seedRateStandard();   // ← add this line
//   await seedRates();
//   await seedAllocations();
//   await createCostView();
// }

// ─── Updated required files check ────────────────────────────────────────────
// const required = ["JIRA.csv", "RESSOURCES.csv", "RateStandard.csv", "RATES.csv", "Assignement.csv"];



// ─── 3. Rates ────────────────────────────────────────────────────────────────

async function seedRates(): Promise<void> {
  console.log("Seeding rates from RATES.csv...");
  const rows = readCsv("RATES.csv", "utf8");

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const rateId     = row["RateId"]?.trim();
    const resourceId = row["RessourceId"]?.trim();

    // Skip orphaned rows, header echoes, and dirty resourceId values
if (!rateId || !resourceId || resourceId === "RessourceId" || resourceId === "0") {
  skipped++;
  continue;
}

    const year      = parseInt(row["Year"]);
    const dailyRate = parseNum(row["Daily Cost "]);  // note trailing space in column name
    const nbrDays   = parseNum(row["Nbr of Days per Year "]);

    if (isNaN(year) || dailyRate === null) { skipped++; continue; }

    // Verify the resource exists (was not skipped above due to missing ID)
    const exists = await prisma.resource.findUnique({
      where: { id: resourceId },
      select: { id: true },
    });
    if (!exists) { skipped++; continue; }

    await prisma.rate.upsert({
      where: { resourceId_year: { resourceId, year } },
      update: {
        dailyRate,
        nbrDaysPerYear: nbrDays,
        modifiedOn:     NOW,
      },
      create: {
        id: `RATE-${resourceId}-${year}`,
        resourceId,
        year,
        dailyRate,
        nbrDaysPerYear: nbrDays,
        createdOn:      NOW,
        modifiedOn:     NOW,
      },
    });
    upserted++;
  }

  console.log(`  ✓ Rates: ${upserted} upserted, ${skipped} skipped\n`);
}

// ─── 4. Allocations ──────────────────────────────────────────────────────────

async function seedAllocations(): Promise<void> {
  console.log(
    "Seeding allocations from Assignement.csv (CSV rows merged; existing pairs add % and man-days)..."
  );
  const rows = readCsv("Assignement.csv", "utf8");

  const [initiativeIds, resourceIds] = await Promise.all([
    prisma.initiative.findMany({ select: { id: true } }).then((r) => new Set(r.map((x) => x.id))),
    prisma.resource.findMany({ select: { id: true } }).then((r) => new Set(r.map((x) => x.id))),
  ]);

  let skipped = 0;
  let unknownInitiative = 0;
  let unknownResource = 0;
  const missingInit = new Set<string>();

  type MergeAcc = { sumQuantity: number; sumManDays: number };
  const mergeMap = new Map<string, MergeAcc>();
  let validCsvLines = 0;

  for (const row of rows) {
    const resourceId = row["RessourceId"]?.trim();
    const initiativeId = row["InitiativeId"]?.trim();

    if (
      !resourceId ||
      !initiativeId ||
      resourceId === "RessourceId" ||
      resourceId === "-" ||
      initiativeId === "-"
    ) {
      skipped++;
      continue;
    }

    if (!initiativeIds.has(initiativeId)) {
      missingInit.add(initiativeId);
      unknownInitiative++;
      continue;
    }

    if (!resourceIds.has(resourceId)) {
      unknownResource++;
      continue;
    }

    validCsvLines++;

    // Percent column: 0-100 scale → decimal; ManDays: day count (parseNum strips %)
    const percentRaw = parseNum(row["Percent assignement "]);
    const manDaysRaw = parseNum(row["Man Days Assignement"]);

    const dq =
      percentRaw !== null && percentRaw > 0 ? percentRaw / 100 : 0;
    const dm =
      manDaysRaw !== null && manDaysRaw > 0 ? manDaysRaw : 0;

    const pairKey = `${resourceId}\t${initiativeId}`;
    let acc = mergeMap.get(pairKey);
    if (!acc) {
      acc = { sumQuantity: 0, sumManDays: 0 };
      mergeMap.set(pairKey, acc);
    }
    acc.sumQuantity += dq;
    acc.sumManDays += dm;
  }

  const mergedRows: {
    resourceId: string;
    initiativeId: string;
    quantity: number | null;
    manDays: number | null;
  }[] = [];

  for (const [pairKey, acc] of mergeMap) {
    const [resourceId, initiativeId] = pairKey.split("\t");
    const quantity = acc.sumQuantity > 0 ? acc.sumQuantity : null;
    const manDays = acc.sumManDays > 0 ? acc.sumManDays : null;
    if (quantity == null && manDays == null) continue;
    mergedRows.push({ resourceId, initiativeId, quantity, manDays });
  }

  const duplicateLinesMerged = validCsvLines - mergedRows.length;

  const ALLOC_BATCH = 500;
  const UPDATE_CONCURRENCY = 64;
  let allocationCreated = 0;
  let allocationUpdated = 0;

  if (mergedRows.length > 0) {
    const ids = mergedRows.map((row) =>
      allocationIdFromPair(row.resourceId, row.initiativeId)
    );
    const existingById = new Map<
      string,
      { quantity: number | null; manDays: number | null }
    >();
    for (let i = 0; i < ids.length; i += ALLOC_BATCH) {
      const chunkIds = ids.slice(i, i + ALLOC_BATCH);
      const found = await prisma.allocation.findMany({
        where: { id: { in: chunkIds } },
        select: { id: true, quantity: true, manDays: true },
      });
      for (const r of found) {
        existingById.set(r.id, { quantity: r.quantity, manDays: r.manDays });
      }
    }

    type CreateRow = {
      id: string;
      initiativeId: string;
      resourceId: string;
      manDays: number | null;
      quantity: number | null;
      createdOn: Date;
      modifiedOn: Date;
    };
    const createRows: CreateRow[] = [];
    const updateOps: { id: string; quantity: number | null; manDays: number | null }[] = [];

    for (const row of mergedRows) {
      const id = allocationIdFromPair(row.resourceId, row.initiativeId);
      const addQ = row.quantity ?? 0;
      const addM = row.manDays ?? 0;
      const ex = existingById.get(id);
      const baseQ = ex?.quantity ?? 0;
      const baseM = ex?.manDays ?? 0;
      const finalQ = baseQ + addQ;
      const finalM = baseM + addM;
      const quantity = finalQ > 0 ? finalQ : null;
      const manDays = finalM > 0 ? finalM : null;

      if (quantity == null && manDays == null) {
        continue;
      }

      if (ex) {
        updateOps.push({ id, quantity, manDays });
      } else {
        createRows.push({
          id,
          initiativeId: row.initiativeId,
          resourceId: row.resourceId,
          manDays,
          quantity,
          createdOn: NOW,
          modifiedOn: NOW,
        });
      }
    }

    for (let i = 0; i < createRows.length; i += ALLOC_BATCH) {
      await prisma.allocation.createMany({
        data: createRows.slice(i, i + ALLOC_BATCH),
      });
    }

    for (let i = 0; i < updateOps.length; i += UPDATE_CONCURRENCY) {
      const slice = updateOps.slice(i, i + UPDATE_CONCURRENCY);
      await Promise.all(
        slice.map((op) =>
          prisma.allocation.update({
            where: { id: op.id },
            data: {
              quantity: op.quantity,
              manDays: op.manDays,
              modifiedOn: NOW,
            },
          })
        )
      );
    }

    allocationCreated = createRows.length;
    allocationUpdated = updateOps.length;
  }

  if (missingInit.size > 0) {
    console.log(
      `  ⚠ ${unknownInitiative} rows skipped: InitiativeId not in JIRA (sample):`
    );
    [...missingInit].slice(0, 12).forEach((id) => console.log(`      ${id}`));
    if (missingInit.size > 12) {
      console.log(`      … +${missingInit.size - 12} more`);
    }
  }
  if (unknownResource > 0) {
    console.log(`  ⚠ ${unknownResource} rows skipped: RessourceId not in RESSOURCES`);
  }
  if (duplicateLinesMerged > 0) {
    console.log(
      `  (${duplicateLinesMerged} CSV lines merged into duplicate resource+initiative pairs)`
    );
  }

  console.log(
    `  ✓ Allocations: ${allocationCreated} created, ${allocationUpdated} updated (additive on existing pairs; ${skipped} skipped, ${unknownInitiative} bad initiative, ${unknownResource} bad resource)\n`
  );
}

// ─── 5. Cost View ────────────────────────────────────────────────────────────

async function createCostView(): Promise<void> {
  console.log("Creating v_allocation_costs view...");

  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_allocation_costs`);

  await prisma.$executeRawUnsafe(`
    CREATE VIEW v_allocation_costs AS
    SELECT
      a.id                                                            AS allocation_id,
      i.id                                                            AS jira_key,
      i."powerId"                                                     AS power_id,
      i.summary,
      i.year                                                          AS initiative_year,
      i.components                                                    AS product,
      COALESCE(
        REPLACE(i."productGroup", '&', 'and'),
        'Unassigned'
      )                                                               AS product_group,
      i."initiativeType"                                              AS initiative_type,
      i.status,
      r.id                                                            AS resource_id,
      r."fullName"                                                    AS resource_name,
      r.type                                                          AS resource_type,
      r.cellule,
      r.direction,
      a."manDays"                                                     AS man_days,
      a.quantity,
      COALESCE(rt."dailyRate",  rs."dailyRate")                       AS effective_rate,
      CASE
        WHEN r.type IN ('INTERNAL', 'EXTERNAL') THEN
          COALESCE(
            rt."nbrDaysPerYear",
            CAST(rs."nbrDaysPerYear" AS double precision)
          )
        ELSE
          COALESCE(
            CAST(rt."nbrDaysPerYear" AS double precision),
            CAST(rs_dc."nbrDaysPerYear" AS double precision)
          )
      END                                                             AS effective_days_per_year,

      -- Total cost (DIRECT_COST: man_days×rate OR quantity×days/year×rate like FTE staff)
      CASE
        WHEN r.type = 'DIRECT_COST' THEN
          CASE
            WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
              a."manDays" * COALESCE(rt."dailyRate", CAST(0 AS double precision))
            WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
              a.quantity
              * CAST(
                COALESCE(
                  CASE
                    WHEN rt."nbrDaysPerYear" IS NOT NULL AND CAST(rt."nbrDaysPerYear" AS numeric) > 0
                    THEN CAST(rt."nbrDaysPerYear" AS numeric)
                  END,
                  CAST(rs_dc."nbrDaysPerYear" AS numeric)
                ) AS double precision
              )
              * COALESCE(rt."dailyRate", CAST(0 AS double precision))
            ELSE CAST(0 AS double precision)
          END
        WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays" * COALESCE(rt."dailyRate", rs."dailyRate")
        WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity
          * COALESCE(
            rt."nbrDaysPerYear",
            CAST(rs."nbrDaysPerYear" AS double precision)
          )
          * COALESCE(rt."dailyRate", rs."dailyRate")
        ELSE 0
      END                                                             AS computed_cost,

      -- Internal cost
      CASE
        WHEN r.type = 'INTERNAL' AND a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays" * COALESCE(rt."dailyRate", rs."dailyRate")
        WHEN r.type = 'INTERNAL' AND a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity
          * COALESCE(
            rt."nbrDaysPerYear",
            CAST(rs."nbrDaysPerYear" AS double precision)
          )
          * COALESCE(rt."dailyRate", rs."dailyRate")
        ELSE 0
      END                                                             AS internal_cost,

      -- External cost
      CASE
        WHEN r.type = 'EXTERNAL' AND a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays" * COALESCE(rt."dailyRate", rs."dailyRate")
        WHEN r.type = 'EXTERNAL' AND a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity
          * COALESCE(
            rt."nbrDaysPerYear",
            CAST(rs."nbrDaysPerYear" AS double precision)
          )
          * COALESCE(rt."dailyRate", rs."dailyRate")
        ELSE 0
      END                                                             AS external_cost,

      -- Direct cost (same rule as computed_cost for DIRECT_COST)
      CASE
        WHEN r.type = 'DIRECT_COST' THEN
          CASE
            WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
              a."manDays" * COALESCE(rt."dailyRate", CAST(0 AS double precision))
            WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
              a.quantity
              * CAST(
                COALESCE(
                  CASE
                    WHEN rt."nbrDaysPerYear" IS NOT NULL AND CAST(rt."nbrDaysPerYear" AS numeric) > 0
                    THEN CAST(rt."nbrDaysPerYear" AS numeric)
                  END,
                  CAST(rs_dc."nbrDaysPerYear" AS numeric)
                ) AS double precision
              )
              * COALESCE(rt."dailyRate", CAST(0 AS double precision))
            ELSE CAST(0 AS double precision)
          END
        ELSE 0
      END                                                             AS direct_cost,

      -- FTE % (Internal/External, FTE method only)
      CASE
        WHEN r.type IN ('INTERNAL', 'EXTERNAL')
         AND a.quantity IS NOT NULL AND a.quantity > 0
         AND (a."manDays" IS NULL OR a."manDays" = 0)
        THEN a.quantity
        ELSE 0
      END                                                             AS fte_decimal,

      CASE
        WHEN r.type IN ('INTERNAL', 'EXTERNAL')
         AND a.quantity IS NOT NULL AND a.quantity > 0
         AND (a."manDays" IS NULL OR a."manDays" = 0)
        THEN a.quantity * 100
        ELSE 0
      END                                                             AS fte_percent,

      -- Unified volume: staff = man-days or FTE×days; direct = man-days or quantity×days/year
      CASE
        WHEN r.type = 'DIRECT_COST' THEN
          CASE
            WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN CAST(a."manDays" AS double precision)
            WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
              a.quantity
              * CAST(
                COALESCE(
                  CASE
                    WHEN rt."nbrDaysPerYear" IS NOT NULL AND CAST(rt."nbrDaysPerYear" AS numeric) > 1
                    THEN CAST(rt."nbrDaysPerYear" AS numeric)
                  END,
                  CAST(rs_dc."nbrDaysPerYear" AS numeric)
                ) AS double precision
              )
            ELSE 0
          END
        WHEN r.type IN ('INTERNAL', 'EXTERNAL') AND a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays"
        WHEN r.type IN ('INTERNAL', 'EXTERNAL') AND a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity * COALESCE(
            rt."nbrDaysPerYear",
            CAST(rs."nbrDaysPerYear" AS double precision)
          )
        ELSE 0
      END                                                             AS calculated_man_days

    FROM allocation a
    JOIN initiative i   ON i.id = a."initiativeId"
    JOIN resource r     ON r.id = a."resourceId"
    LEFT JOIN rate rt
      ON  rt."resourceId" = r.id
      AND rt.year         = i.year
    LEFT JOIN rate_standard rs
      ON  rs.year = i.year
      AND rs.type = r.type
      AND r.type <> 'DIRECT_COST'
    LEFT JOIN rate_standard rs_dc
      ON  rs_dc.year = i.year
      AND rs_dc.type = 'INTERNAL'
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
    console.log("✅ View updated.");
    return;
  }

  console.log("🌱 Starting production seed...\n");
  console.log(`📁 Data directory: ${DATA_DIR}\n`);

  const required = ["JIRA.csv", "RESSOURCES.csv", "RATES.csv", "Assignement.csv", "RateStandard.csv"];

  for (const f of required) {
    if (!fs.existsSync(path.join(DATA_DIR, f))) {
      console.error(`❌ Missing: scripts/data-prod/${f}`);
      process.exit(1);
    }
  }

  // Order matters — FKs must exist before they are referenced
  await seedInitiatives();   // no FK dependencies
  await seedResources();     // no FK dependencies
  await seedRateStandard();  // depends on Resource
  await seedRates();         // depends on Resource
  await seedAllocations();   // depends on Initiative + Resource
  await createCostView();

  console.log("✅ Production seed complete.");
}

main()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
