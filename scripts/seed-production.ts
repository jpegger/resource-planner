/**
 * Production seed — ID-linked CSVs under `scripts/data-prod/`.
 *
 * JIRA / RESSOURCES: latin-1 · RATES / Assignement / RateStandard: utf-8 (BOM stripped).
 * Initiatives get `productId` from PRODUCTS + Jira Components (run `npm run db:seed:products` first).
 * Duplicate Assignement rows (same resource + initiative): % summed across lines. Man-days: if
 * several lines have man-days > 0, the first line in CSV order wins (avoids double-counting
 * duplicate exports such as 12 + 7 for the same assignment). Existing DB pairs still get CSV
 * deltas added (additive re-import).
 *
 * Full wipe + reload: `SEED_PROD_RESET=1 npm run db:seed:prod` (does not delete `product` rows).
 * View only: `SEED_VIEW_ONLY=1 npm run db:seed:prod`
 * v_eotp_costs only (after migrate dropped views): `npm run db:recreate:eotp-costs` (needs v_allocation_costs)
 *
 * RateStandard.csv: required in data-prod, or falls back to `scripts/data/RateStandard.csv`.
 */

import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient, ResourceType } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";
import { createEotpCostsView } from "./eotp-views";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });
const DATA_DIR = path.join(__dirname, "data-prod");
const DEV_DATA_DIR = path.join(__dirname, "data");

function resolveRateStandardPath(): string | null {
  const prod = path.join(DATA_DIR, "RateStandard.csv");
  if (fs.existsSync(prod)) return prod;
  const dev = path.join(DEV_DATA_DIR, "RateStandard.csv");
  return fs.existsSync(dev) ? dev : null;
}

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
  const key = (raw ?? "").toLowerCase().trim();
  const map: Record<string, ResourceType> = {
    internal: ResourceType.INTERNAL,
    external: ResourceType.EXTERNAL,
    "direct costs": ResourceType.DIRECT_COST,
    "direct cost": ResourceType.DIRECT_COST,
  };
  return map[key] ?? null;
}

const NOW = new Date();

/** Stable id: one allocation row per (resourceId, initiativeId). */
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

  const productMap = new Map<string, string>();
  const allProducts = await prisma.product.findMany({ select: { id: true, name: true } });
  for (const p of allProducts) {
    productMap.set(p.name.trim().toLowerCase(), p.id);
  }
  console.log(`  Product lookup map: ${productMap.size} entries`);

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = row["Key"]?.trim();
    if (!id) {
      skipped++;
      continue;
    }

    const year = parseInt(row["(RI) Year"] ?? "", 10);
    if (Number.isNaN(year)) {
      skipped++;
      continue;
    }

    const componentValues: string[] = [
      row["Components"],
      row["Components_1"],
      row["Components_2"],
      row["Components_3"],
    ]
      .map((v) => (v ?? "").trim())
      .filter(Boolean);

    let productId: string | null = null;
    for (const comp of componentValues) {
      const found = productMap.get(comp.toLowerCase());
      if (found) {
        productId = found;
        break;
      }
    }

    await prisma.initiative.upsert({
      where: { id },
      update: {
        summary: row["Summary"]?.trim() ?? "",
        status: row["Status"]?.trim() ?? "",
        year,
        components: row["Components"]?.trim() || null,
        productGroup: row["(RI) Product Group"]?.trim() || null,
        initiativeType: row["(RI) Type"]?.trim() || null,
        productId,
        modifiedOn: NOW,
      },
      create: {
        id,
        powerId: null,
        summary: row["Summary"]?.trim() ?? "",
        status: row["Status"]?.trim() ?? "",
        year,
        components: row["Components"]?.trim() || null,
        productGroup: row["(RI) Product Group"]?.trim() || null,
        initiativeType: row["(RI) Type"]?.trim() || null,
        productId,
        createdOn: NOW,
        modifiedOn: NOW,
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

async function seedRateStandard(): Promise<void> {
  const csvPath = resolveRateStandardPath();
  if (!csvPath) {
    console.warn(
      "  ⚠ No RateStandard.csv in data-prod or scripts/data — rate_standard skipped\n"
    );
    return;
  }

  console.log(`Seeding standard rates from ${path.relative(process.cwd(), csvPath)}...`);
  const content = fs.readFileSync(csvPath, { encoding: "utf-8" });
  const cleaned = content.replace(/^\uFEFF/, "");
  const result = Papa.parse(cleaned, { header: true, skipEmptyLines: true });
  const rows = result.data as Record<string, string>[];

  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = row["RateStandardPrimaryId"]?.trim();
    const year = parseInt(row["Year"] ?? "", 10);
    const dailyRate = parseNum(row["DailyRate"]);
    const nbrDaysPerYear = parseInt(row["NbrOfDaysPerYear"] ?? "", 10);

    if (!id || Number.isNaN(year) || dailyRate === null || Number.isNaN(nbrDaysPerYear)) {
      skipped++;
      continue;
    }

    const rawType = row["IsInternalOrExternal"]?.trim();
    const type = parseResourceType(rawType);
    if (!type || type === ResourceType.DIRECT_COST) {
      skipped++;
      continue;
    }

    const createdOn = row["Created On"]?.trim()
      ? new Date(row["Created On"])
      : NOW;
    const modifiedOn = row["Modified On"]?.trim()
      ? new Date(row["Modified On"])
      : NOW;

    await prisma.rateStandard.upsert({
      where: { year_type: { year, type } },
      update: { dailyRate, nbrDaysPerYear, modifiedOn: NOW },
      create: {
        id,
        year,
        type,
        dailyRate,
        nbrDaysPerYear,
        createdOn,
        modifiedOn,
      },
    });
    upserted++;
  }

  console.log(`  ✓ Standard rates: ${upserted} upserted, ${skipped} skipped\n`);
}

async function clearPlannerTables(): Promise<void> {
  await prisma.allocation.deleteMany({});
  await prisma.rate.deleteMany({});
  await prisma.initiative.deleteMany({});
  await prisma.rateStandard.deleteMany({});
  await prisma.resource.deleteMany({});
}

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
    "Seeding allocations from Assignement.csv (merged by pair: % summed; first man-days line wins)..."
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

  type MergeAcc = { sumQuantity: number; manDaysFirst: number | null };
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
      manDaysRaw !== null && manDaysRaw > 0 ? manDaysRaw : null;

    const pairKey = `${resourceId}\t${initiativeId}`;
    let acc = mergeMap.get(pairKey);
    if (!acc) {
      acc = { sumQuantity: 0, manDaysFirst: null };
      mergeMap.set(pairKey, acc);
    }
    acc.sumQuantity += dq;
    if (dm !== null && acc.manDaysFirst === null) {
      acc.manDaysFirst = dm;
    }
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
    const manDays = acc.manDaysFirst;
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
  const fteDaysPerYear = `CAST(
    COALESCE(
      rt."nbrDaysPerYear",
      CAST(rs."nbrDaysPerYear" AS double precision)
    ) AS double precision)`;

  // Direct costs: unit model (nbrDaysPerYear on the rate row, usually 1). Never fall back to
  // INTERNAL RateStandard (200) — missing rate row must not inflate quantity into 200 "man-days".
  const directCostQtyDays = `CAST(
    COALESCE(
      CASE
        WHEN rt."nbrDaysPerYear" IS NOT NULL AND CAST(rt."nbrDaysPerYear" AS numeric) > 0
        THEN CAST(rt."nbrDaysPerYear" AS numeric)
      END,
      CAST(1 AS double precision)
    ) AS double precision)`;

  const effectiveDaysPerYear = `CASE
    WHEN r.type IN ('INTERNAL', 'EXTERNAL') THEN ${fteDaysPerYear}
    ELSE COALESCE(
      CAST(rt."nbrDaysPerYear" AS double precision),
      CAST(1 AS double precision)
    )
  END`;

  console.log("Creating v_allocation_costs...");

  // If additional views depend on v_allocation_costs (e.g. v_eotp_costs),
  // drop them first to keep the seed idempotent.
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_eotp_routing`);
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_eotp_costs`);
  await prisma.$executeRawUnsafe(`DROP VIEW IF EXISTS v_allocation_costs`);

  await prisma.$executeRawUnsafe(`
    CREATE VIEW v_allocation_costs AS
    SELECT
      a.id                                                          AS allocation_id,
      i.id                                                          AS jira_key,
      i."powerId"                                                   AS power_id,
      i.summary,
      i.year                                                        AS initiative_year,
      i.components                                                  AS product,
      COALESCE(REPLACE(i."productGroup", '&', 'and'),
                'Unassigned'
              )                                                     AS product_group,

      COALESCE(p."name", 'Unassigned')                              AS product_name,
      COALESCE(REPLACE(p."productFamily", '&', 'and'), 'Unassigned') AS product_family,
      COALESCE(p."division", 'Unassigned')                          AS division,
      COALESCE(p."subDivision", 'Unassigned')                     AS sub_division,
      COALESCE(p."team", 'Unassigned')                            AS team,
      COALESCE(p."sapEotpCode", 'Unassigned')                     AS sap_eotp_code,
      COALESCE(p."sapEotpName", 'Unassigned')                     AS sap_eotp_name,
      p."attractiveness"                                          AS attractiveness,
      p."competitiveness"                                         AS competitiveness,

      i."initiativeType"                                            AS initiative_type,
      i.status,
      r.id                                                          AS resource_id,
      r."fullName"                                                  AS resource_name,
      r.type                                                        AS resource_type,
      r.cellule,
      r.direction,
      a."manDays"                                                   AS man_days,
      a.quantity,
      COALESCE(rt."dailyRate", rs."dailyRate")                      AS effective_rate,
      ${effectiveDaysPerYear}                                       AS effective_days_per_year,

      CASE
        WHEN r.type = 'DIRECT_COST' THEN
          CASE
            WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
              a."manDays" * COALESCE(rt."dailyRate", CAST(0 AS double precision))
            WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
              a.quantity * ${directCostQtyDays} * COALESCE(rt."dailyRate", CAST(0 AS double precision))
            ELSE CAST(0 AS double precision)
          END
        WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays" * COALESCE(rt."dailyRate", rs."dailyRate")
        WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity * ${fteDaysPerYear} * COALESCE(rt."dailyRate", rs."dailyRate")
        ELSE 0
      END                                                           AS computed_cost,

      CASE
        WHEN r.type = 'INTERNAL' AND a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays" * COALESCE(rt."dailyRate", rs."dailyRate")
        WHEN r.type = 'INTERNAL' AND a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity * ${fteDaysPerYear} * COALESCE(rt."dailyRate", rs."dailyRate")
        ELSE 0
      END                                                           AS internal_cost,

      CASE
        WHEN r.type = 'EXTERNAL' AND a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays" * COALESCE(rt."dailyRate", rs."dailyRate")
        WHEN r.type = 'EXTERNAL' AND a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity * ${fteDaysPerYear} * COALESCE(rt."dailyRate", rs."dailyRate")
        ELSE 0
      END                                                           AS external_cost,

      CASE
        WHEN r.type = 'DIRECT_COST' THEN
          CASE
            WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
              a."manDays" * COALESCE(rt."dailyRate", CAST(0 AS double precision))
            WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
              a.quantity * ${directCostQtyDays} * COALESCE(rt."dailyRate", CAST(0 AS double precision))
            ELSE CAST(0 AS double precision)
          END
        ELSE 0
      END                                                           AS direct_cost,

      -- FTE as decimal 0–1: quantity when FTE-billing; if man-days only, implied FTE = man_days ÷ days/year
      CASE
        WHEN r.type IN ('INTERNAL', 'EXTERNAL')
         AND a."manDays" IS NOT NULL AND a."manDays" > 0
        THEN COALESCE(a."manDays" / NULLIF(${fteDaysPerYear}, 0), 0)
        WHEN r.type IN ('INTERNAL', 'EXTERNAL')
         AND a.quantity IS NOT NULL AND a.quantity > 0
        THEN a.quantity
        ELSE 0
      END                                                           AS fte_decimal,

      CASE
        WHEN r.type IN ('INTERNAL', 'EXTERNAL')
         AND a."manDays" IS NOT NULL AND a."manDays" > 0
        THEN COALESCE(a."manDays" / NULLIF(${fteDaysPerYear}, 0), 0) * 100
        WHEN r.type IN ('INTERNAL', 'EXTERNAL')
         AND a.quantity IS NOT NULL AND a.quantity > 0
        THEN a.quantity * 100
        ELSE 0
      END                                                           AS fte_percent,

      CASE
        WHEN r.type = 'DIRECT_COST' THEN
          CASE
            WHEN a."manDays" IS NOT NULL AND a."manDays" > 0 THEN CAST(a."manDays" AS double precision)
            WHEN a.quantity IS NOT NULL AND a.quantity > 0 THEN
              a.quantity * ${directCostQtyDays}
            ELSE 0
          END
        WHEN r.type IN ('INTERNAL', 'EXTERNAL') AND a."manDays" IS NOT NULL AND a."manDays" > 0 THEN
          a."manDays"
        WHEN r.type IN ('INTERNAL', 'EXTERNAL') AND a.quantity IS NOT NULL AND a.quantity > 0 THEN
          a.quantity * ${fteDaysPerYear}
        ELSE 0
      END                                                           AS calculated_man_days

    FROM allocation a
    JOIN initiative i   ON i.id = a."initiativeId"
    LEFT JOIN product p ON p.id = i."productId"
    JOIN resource r     ON r.id = a."resourceId"
    LEFT JOIN rate rt
      ON rt."resourceId" = r.id
     AND rt.year = i.year
    LEFT JOIN rate_standard rs
      ON rs.year = i.year
     AND rs.type = r.type
     AND r.type <> 'DIRECT_COST'
  `);

  console.log("  ✓ v_allocation_costs created\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const viewOnly =
    process.env["SEED_VIEW_ONLY"] === "1" ||
    process.env["SEED_VIEW_ONLY"] === "true";

  if (viewOnly) {
    console.log("SEED_VIEW_ONLY: recreating v_allocation_costs (no CSV import)…\n");
    await createCostView();
    await createEotpCostsView(prisma);
    console.log("Done.");
    return;
  }

  console.log("🌱 Production seed\n");
  console.log(`   ${DATA_DIR}\n`);

  const required = ["JIRA.csv", "RESSOURCES.csv", "RATES.csv", "Assignement.csv"];
  for (const f of required) {
    if (!fs.existsSync(path.join(DATA_DIR, f))) {
      console.error(`Missing: ${path.join("scripts/data-prod", f)}`);
      process.exit(1);
    }
  }
  if (!resolveRateStandardPath()) {
    console.error("Missing: RateStandard.csv in scripts/data-prod or scripts/data/RateStandard.csv");
    process.exit(1);
  }

  const fullReset =
    process.env["SEED_PROD_RESET"] === "1" ||
    process.env["SEED_PROD_RESET"] === "true";
  if (fullReset) {
    console.log("SEED_PROD_RESET: clearing planner tables (product table preserved)…\n");
    await clearPlannerTables();
  } else {
    console.log(
      "(Upsert mode — set SEED_PROD_RESET=1 to truncate before import; allocations add to existing pairs)\n"
    );
  }

  await seedInitiatives();
  await seedResources();
  await seedRateStandard();
  await seedRates();
  await seedAllocations();
  await createCostView();
  await createEotpCostsView(prisma);

  console.log("Done.");
}

main()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
