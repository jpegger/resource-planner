/**
 * Production seed — loads CSVs from `scripts/data-prod/`.
 *
 * Linking model (IDs only, no text matching):
 *   • Initiatives     JIRA.csv `Key`                    ↔ Assignement `InitiativeId`
 *   • Resources       RESSOURCES.csv `ID`               ↔ Assignement `RessourceId`, RATES `RessourceId`
 *   • Rates           RATES.csv `RessourceId` + `Year`   ↔ resource + initiative year (via view)
 *   • Allocations     `InitiativeId` + `RessourceId`    → FK to initiative.id and resource.id
 *
 * Usage: `npm run db:seed:prod`  (see package.json)
 *
 * Full reload (truncate then import): `SEED_PROD_RESET=1 npm run db:seed:prod`
 * Without that, rows are upserted and old allocations not in CSV are left in place.
 *
 * View only (no CSV import): `npm run db:view:prod` or `SEED_VIEW_ONLY=1 tsx scripts/seed-production.ts`
 *
 * Files required under scripts/data-prod/:
 *   JIRA.csv, RESSOURCES.csv, RATES.csv, Assignement.csv
 *
 * Optional: RateStandard.csv in data-prod; else falls back to scripts/data/RateStandard.csv.
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
const DEV_DATA_DIR = path.join(__dirname, "data");

function t(): Date {
  return new Date();
}

// ─── CSV ─────────────────────────────────────────────────────────────────────

/**
 * Papa Parse calls transformHeader twice while building the header row.
 * Do not use a stateful “dedupe” Map here — it would rename every column to Name__2
 * and break lookups (row["Key"] → undefined → all rows skipped).
 */
function transformHeaderTrim(header: string): string {
  const trimmed = header.replace(/^\uFEFF/, "").trim();
  return trimmed === "" ? "__empty" : trimmed;
}

function parseWithHeaders(csvBody: string): Record<string, string>[] {
  const result = Papa.parse(csvBody, {
    header: true,
    skipEmptyLines: true,
    transformHeader: transformHeaderTrim,
  });
  return (result.data as Record<string, string>[]).map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k.replace(/^\uFEFF/, "").trim()] =
        typeof v === "string" ? v : String(v ?? "");
    }
    return out;
  });
}

/** Find first line index within `lines` where `predicate` is true (header row). */
function findHeaderLine(
  lines: string[],
  predicate: (line: string) => boolean,
  maxScan = 15
): number {
  for (let i = 0; i < Math.min(maxScan, lines.length); i++) {
    if (predicate(lines[i])) return i;
  }
  return 0;
}

function readDataProdCsv(filename: string): string {
  let s = fs.readFileSync(path.join(DATA_DIR, filename), { encoding: "utf-8" });
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  return s;
}

/** First non-empty cell value for common column aliases (trimmed). */
function cell(
  row: Record<string, string>,
  ...aliases: string[]
): string | undefined {
  for (const name of aliases) {
    const v = row[name]?.trim();
    if (v) return v;
  }
  const want = new Set(aliases.map((a) => a.trim().toLowerCase()));
  for (const [k, v] of Object.entries(row)) {
    if (want.has(k.trim().toLowerCase())) {
      const t = (v ?? "").trim();
      if (t) return t;
    }
  }
  return undefined;
}

function parseFloat_(value: string | undefined): number | null {
  if (!value || value.trim() === "" || value.trim() === "NaN") return null;
  const cleaned = value.replace(/'/g, "").replace(/\s/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

function parsePercent(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const cleaned = value.replace("%", "").trim();
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? null : n / 100;
}

function parseResourceType(raw: string | undefined): ResourceType | null {
  const key = raw?.toLowerCase()?.trim() ?? "";
  if (!key) return null;
  const map: Record<string, ResourceType> = {
    internal: ResourceType.INTERNAL,
    external: ResourceType.EXTERNAL,
    "direct costs": ResourceType.DIRECT_COST,
    "direct cost": ResourceType.DIRECT_COST,
  };
  return map[key] ?? null;
}

function csvRowIsAllEmpty(row: Record<string, string>): boolean {
  return Object.values(row).every((v) => !String(v ?? "").trim());
}

/** Excel exports often end the header row with `,,,,` — Papa treats those as duplicate "" columns. */
function fixCsvHeaderEmptyTrailingFields(headerLine: string): string {
  const parts = headerLine.split(",");
  let emptySeq = 0;
  return parts
    .map((p) => {
      const t = p.replace(/^\uFEFF/, "").trim();
      if (t === "") {
        emptySeq++;
        return `__empty_${emptySeq}`;
      }
      return p.replace(/^\uFEFF/, "").trimEnd();
    })
    .join(",");
}

function allocationIdFromRow(parts: string[]): string {
  const h = createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
  return `ASS-${h.slice(0, 32)}`;
}

/** Primary key for rate rows — CSV RateId is not unique; @@unique is [resourceId, year]. */
function rateIdFromResourceYear(resourceId: string, year: number): string {
  const h = createHash("sha256")
    .update(`${resourceId}|${year}`, "utf8")
    .digest("hex");
  return `RATE-${h.slice(0, 32)}`;
}

function resolveRateStandardPath(): string | null {
  const prod = path.join(DATA_DIR, "RateStandard.csv");
  if (fs.existsSync(prod)) return prod;
  const dev = path.join(DEV_DATA_DIR, "RateStandard.csv");
  return fs.existsSync(dev) ? dev : null;
}

// ─── Wipe (full reload from CSV) ─────────────────────────────────────────────

async function clearPlannerTables(): Promise<void> {
  await prisma.allocation.deleteMany({});
  await prisma.rate.deleteMany({});
  await prisma.initiative.deleteMany({});
  await prisma.rateStandard.deleteMany({});
  await prisma.resource.deleteMany({});
}

// ─── 1. Initiatives — id = Jira key (Key) ────────────────────────────────────

async function seedInitiatives(): Promise<void> {
  console.log("Seeding initiatives (id = JIRA Key → matches Assignement InitiativeId)...");

  const content = readDataProdCsv("JIRA.csv");
  const rows = parseWithHeaders(content);

  let n = 0;
  let skipped = 0;

  for (const row of rows) {
    const id = cell(row, "Key")?.trim();
    if (!id) {
      skipped++;
      continue;
    }

    const year = parseInt(row["(RI) Year"] ?? "", 10);
    if (Number.isNaN(year)) {
      skipped++;
      continue;
    }

    const summary = row["Summary"]?.trim() ?? "";
    const components = row["Components"]?.trim() ?? null;
    const productGroup = row["(RI) Product Group"]?.trim() ?? null;
    const status = row["Status"]?.trim() ?? "";
    const initiativeType = row["(RI) Type"]?.trim() ?? null;

    await prisma.initiative.upsert({
      where: { id },
      update: {
        summary,
        status,
        year,
        components,
        productGroup,
        initiativeType,
        modifiedOn: t(),
      },
      create: {
        id,
        powerId: null,
        summary,
        status,
        year,
        components,
        productGroup,
        initiativeType,
        createdOn: t(),
        modifiedOn: t(),
      },
    });
    n++;
  }

  console.log(`  ✓ Initiatives: ${n} rows (${skipped} skipped)\n`);
}

// ─── 2. Resources — id = ID column (MAT-…) ───────────────────────────────────

async function seedResources(): Promise<void> {
  console.log("Seeding resources (id = ID → matches RessourceId in RATES & Assignement)...");

  const raw = readDataProdCsv("RESSOURCES.csv");
  const lines = raw.split("\n");
  const headerIdx = findHeaderLine(
    lines,
    (l) => l.includes("ID") && (l.includes("Full Name") || l.includes("Nom"))
  );
  const rows = parseWithHeaders(lines.slice(headerIdx).join("\n"));

  let n = 0;
  let ignoredEmptyRows = 0;
  let skippedNoId = 0;
  let skippedBadType = 0;
  let skippedNoName = 0;

  for (const row of rows) {
    if (csvRowIsAllEmpty(row)) {
      ignoredEmptyRows++;
      continue;
    }

    const id = cell(row, "ID", "             ID")?.trim();
    if (!id || id === "ID") {
      skippedNoId++;
      continue;
    }

    const rawType = row["Internal or External"]?.trim();
    const type = parseResourceType(rawType);
    if (!type) {
      skippedBadType++;
      continue;
    }

    const fullName = (row["Full Name"] ?? row["Nom"] ?? "").trim();
    if (!fullName) {
      skippedNoName++;
      continue;
    }

    await prisma.resource.upsert({
      where: { id },
      update: {
        fullName,
        firstName: row["Prénom"]?.trim() || null,
        lastName: row["Nom"]?.trim() || null,
        function: row["Fonction"]?.trim() || null,
        cellule: row["Cellule"]?.trim() || null,
        direction: row["Pôle"]?.trim() || null,
        type,
        modifiedOn: t(),
      },
      create: {
        id,
        fullName,
        firstName: row["Prénom"]?.trim() || null,
        lastName: row["Nom"]?.trim() || null,
        function: row["Fonction"]?.trim() || null,
        cellule: row["Cellule"]?.trim() || null,
        direction: row["Pôle"]?.trim() || null,
        type,
        createdOn: t(),
        modifiedOn: t(),
      },
    });
    n++;
  }

  console.log(`  ✓ Resources: ${n} upserted`);
  if (ignoredEmptyRows > 0) {
    console.log(
      `     (${ignoredEmptyRows} blank Excel rows ignored — trailing commas / empty lines)`
    );
  }
  const realSkips = skippedNoId + skippedBadType + skippedNoName;
  if (realSkips > 0) {
    console.log(
      `     (${realSkips} skipped: ${skippedNoId} no ID, ${skippedBadType} unknown type, ${skippedNoName} no name)`
    );
  }
  console.log("");
}

// ─── 3. Rate standards (INTERNAL / EXTERNAL year defaults) ───────────────────

async function seedRateStandards(): Promise<void> {
  const csvPath = resolveRateStandardPath();
  if (!csvPath) {
    console.warn(
      "  ⚠ No RateStandard.csv — rate_standard empty (add to data-prod or scripts/data).\n"
    );
    return;
  }

  console.log(
    `Seeding rate_standard from ${path.relative(process.cwd(), csvPath)}...`
  );

  const content = fs.readFileSync(csvPath, { encoding: "utf-8" });
  const rows = parseWithHeaders(content);

  let n = 0;
  let skipped = 0;

  for (const row of rows) {
    const type = parseResourceType(row["IsInternalOrExternal"]);
    if (!type || type === ResourceType.DIRECT_COST) {
      skipped++;
      continue;
    }

    const id = row["RateStandardPrimaryId"]?.trim();
    const year = parseInt(row["Year"] ?? "", 10);
    const dailyRate = parseFloat_(row["DailyRate"]);
    const nbrDaysPerYear = parseInt(row["NbrOfDaysPerYear"] ?? "", 10);
    if (!id || Number.isNaN(year) || dailyRate === null || Number.isNaN(nbrDaysPerYear)) {
      skipped++;
      continue;
    }

    await prisma.rateStandard.upsert({
      where: { year_type: { year, type } },
      update: { dailyRate, nbrDaysPerYear, modifiedOn: t() },
      create: {
        id,
        year,
        type,
        dailyRate,
        nbrDaysPerYear,
        createdOn: t(),
        modifiedOn: t(),
      },
    });
    n++;
  }

  console.log(`  ✓ Rate standards: ${n} rows (${skipped} skipped)\n`);
}

// ─── 4. Rates — RessourceId + Year ─────────────────────────────────────────

async function seedRates(): Promise<void> {
  console.log("Seeding rates (RessourceId → resource.id, Year → matches initiative year)...");

  const raw = readDataProdCsv("RATES.csv");
  const lines = raw.split("\n");
  const headerIdx = findHeaderLine(
    lines,
    (l) => l.includes("RateId") || l.includes("RessourceId")
  );
  const rows = parseWithHeaders(lines.slice(headerIdx).join("\n"));

  const resourceIds = new Set(
    (await prisma.resource.findMany({ select: { id: true } })).map((r) => r.id)
  );

  let n = 0;
  let ignoredEmptyRows = 0;
  let skippedNoResourceId = 0;
  let skippedInvalidNumbers = 0;
  let skippedNoResource = 0;

  for (const row of rows) {
    if (csvRowIsAllEmpty(row)) {
      ignoredEmptyRows++;
      continue;
    }

    const resourceId = cell(row, "RessourceId", "ResourceId")?.trim();
    if (!resourceId) {
      skippedNoResourceId++;
      continue;
    }

    const year = parseInt(row["Year"] ?? "", 10);
    const dailyRate = parseFloat_(
      cell(row, "Daily Cost", "Daily Cost ") ?? row["Daily Cost"]
    );
    const nbrDays = parseFloat_(
      cell(row, "Nbr of Days per Year", "Nbr of Days per Year ") ??
        row["Nbr of Days per Year"]
    );

    if (Number.isNaN(year) || dailyRate === null) {
      skippedInvalidNumbers++;
      continue;
    }

    if (!resourceIds.has(resourceId)) {
      skippedNoResource++;
      continue;
    }

    const id = rateIdFromResourceYear(resourceId, year);

    await prisma.rate.upsert({
      where: { resourceId_year: { resourceId, year } },
      update: { dailyRate, nbrDaysPerYear: nbrDays, modifiedOn: t() },
      create: {
        id,
        resourceId,
        year,
        dailyRate,
        nbrDaysPerYear: nbrDays,
        createdOn: t(),
        modifiedOn: t(),
      },
    });
    n++;
  }

  console.log(`  ✓ Rates: ${n} upserted`);
  if (ignoredEmptyRows > 0) {
    console.log(`     (${ignoredEmptyRows} blank rows ignored)`);
  }
  const rs = skippedNoResourceId + skippedInvalidNumbers + skippedNoResource;
  if (rs > 0) {
    console.log(
      `     (${rs} skipped: ${skippedNoResourceId} no RessourceId, ${skippedInvalidNumbers} bad year/cost, ${skippedNoResource} MAT id not in resources)`
    );
  }
  console.log("");
}

// ─── 5. Allocations — InitiativeId + RessourceId ─────────────────────────────

async function seedAllocations(): Promise<void> {
  console.log(
    "Seeding allocations (InitiativeId → initiative.id, RessourceId → resource.id)..."
  );

  const raw = readDataProdCsv("Assignement.csv");
  const lines = raw.split("\n");
  const headerIdx = findHeaderLine(
    lines,
    (l) =>
      l.includes("RessourceId") ||
      (l.includes("Resource") && l.includes("InitiativeId"))
  );
  const bodyLines = lines.slice(headerIdx);
  if (bodyLines.length > 0) {
    bodyLines[0] = fixCsvHeaderEmptyTrailingFields(bodyLines[0]);
  }
  const rows = parseWithHeaders(bodyLines.join("\n"));

  const [initiativeIds, resourceIds] = await Promise.all([
    prisma.initiative.findMany({ select: { id: true } }).then((r) => new Set(r.map((x) => x.id))),
    prisma.resource.findMany({ select: { id: true } }).then((r) => new Set(r.map((x) => x.id))),
  ]);

  let n = 0;
  let ignoredEmptyRows = 0;
  let skippedMissingIds = 0;
  let unknownInitiative = 0;
  let unknownResource = 0;
  const missingInit = new Set<string>();

  for (const row of rows) {
    if (csvRowIsAllEmpty(row)) {
      ignoredEmptyRows++;
      continue;
    }

    const resourceId =
      cell(row, "RessourceId", "ResourceId", "Ressource ID", "Resource ID")?.trim() ?? "";
    const initiativeId =
      cell(row, "InitiativeId", "Initiative ID")?.trim() ?? "";

    if (!resourceId || !initiativeId) {
      skippedMissingIds++;
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

    const percentRaw =
      cell(row, "Percent assignement", "Percent assignement ", "Percent assignment") ?? "";
    const manDaysRaw =
      cell(row, "Man Days Assignement", "Man Days Assignement ", "Man Days Assignment") ?? "";

    const quantity = parsePercent(percentRaw);
    const manDaysVal = parseFloat_(manDaysRaw);
    const manDays = manDaysVal && manDaysVal > 0 ? manDaysVal : null;
    const quantityClean = quantity && quantity > 0 ? quantity : null;

    const id = allocationIdFromRow([
      resourceId,
      initiativeId,
      percentRaw,
      manDaysRaw,
    ]);

    await prisma.allocation.upsert({
      where: { id },
      create: {
        id,
        initiativeId,
        resourceId,
        manDays,
        quantity: quantityClean,
        createdOn: t(),
        modifiedOn: t(),
      },
      update: {
        initiativeId,
        resourceId,
        manDays,
        quantity: quantityClean,
        modifiedOn: t(),
      },
    });
    n++;
  }

  if (ignoredEmptyRows > 0) {
    console.log(`  (${ignoredEmptyRows} blank rows ignored)`);
  }
  if (missingInit.size > 0) {
    console.log(
      `  ⚠ ${unknownInitiative} rows skipped: InitiativeId not in JIRA.csv (sample):`
    );
    [...missingInit].slice(0, 12).forEach((id) => console.log(`      ${id}`));
    if (missingInit.size > 12) console.log(`      … +${missingInit.size - 12} more keys`);
  }
  if (unknownResource > 0) {
    console.log(`  ⚠ ${unknownResource} rows skipped: RessourceId not in RESSOURCES`);
  }

  console.log(
    `  ✓ Allocations: ${n} upserted (${skippedMissingIds} missing resource/initiative id, ${unknownInitiative} initiative not in JIRA, ${unknownResource} resource not in RESSOURCES)\n`
  );
}

// ─── 6. Cost view ────────────────────────────────────────────────────────────

async function createCostView(): Promise<void> {
  const fteDaysPerYear = `CAST(
    COALESCE(
      CASE
        WHEN rt."nbrDaysPerYear" IS NOT NULL AND CAST(rt."nbrDaysPerYear" AS numeric) > 1
        THEN CAST(rt."nbrDaysPerYear" AS numeric)
      END,
      CAST(rs."nbrDaysPerYear" AS numeric)
    ) AS double precision)`;

  const directCostQtyDays = `CAST(
    COALESCE(
      CASE
        WHEN rt."nbrDaysPerYear" IS NOT NULL AND CAST(rt."nbrDaysPerYear" AS numeric) > 1
        THEN CAST(rt."nbrDaysPerYear" AS numeric)
      END,
      CAST(rs_dc."nbrDaysPerYear" AS numeric)
    ) AS double precision)`;

  const effectiveDaysPerYear = `CASE
    WHEN r.type IN ('INTERNAL', 'EXTERNAL') THEN ${fteDaysPerYear}
    ELSE COALESCE(
      CAST(rt."nbrDaysPerYear" AS double precision),
      CAST(rs_dc."nbrDaysPerYear" AS double precision)
    )
  END`;

  console.log("Creating v_allocation_costs...");

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
      i."productGroup"                          
      COALESCE(REPLACE(i."productGroup", '&', 'and'),
                'Unassigned'
              )                                                     AS product_group,

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

      CASE
        WHEN r.type IN ('INTERNAL', 'EXTERNAL')
         AND a.quantity IS NOT NULL AND a.quantity > 0
         AND (a."manDays" IS NULL OR a."manDays" = 0)
        THEN a.quantity
        ELSE 0
      END                                                           AS fte_decimal,

      CASE
        WHEN r.type IN ('INTERNAL', 'EXTERNAL')
         AND a.quantity IS NOT NULL AND a.quantity > 0
         AND (a."manDays" IS NULL OR a."manDays" = 0)
        THEN a.quantity * 100
        ELSE 0
      END                                                           AS fte_percent,

      -- DIRECT_COST: man-days or quantity×days/year (aligned with quantity cost)
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
    JOIN resource r     ON r.id = a."resourceId"
    LEFT JOIN rate rt
      ON rt."resourceId" = r.id
     AND rt.year = i.year
    LEFT JOIN rate_standard rs
      ON rs.year = i.year
     AND rs.type = r.type
     AND r.type <> 'DIRECT_COST'
    LEFT JOIN rate_standard rs_dc
      ON rs_dc.year = i.year
     AND rs_dc.type = 'INTERNAL'
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
    console.log("Done.");
    return;
  }

  const required = ["JIRA.csv", "RESSOURCES.csv", "RATES.csv", "Assignement.csv"];
  for (const f of required) {
    if (!fs.existsSync(path.join(DATA_DIR, f))) {
      console.error(`Missing: ${path.join("scripts/data-prod", f)}`);
      process.exit(1);
    }
  }

  console.log("🌱 Production seed (data-prod, ID-linked)\n");
  console.log(`   ${DATA_DIR}\n`);

  const fullReset =
    process.env["SEED_PROD_RESET"] === "1" ||
    process.env["SEED_PROD_RESET"] === "true";
  if (fullReset) {
    console.log("SEED_PROD_RESET: clearing planner tables…\n");
    await clearPlannerTables();
  } else {
    console.log(
      "(Upsert mode — set SEED_PROD_RESET=1 to truncate tables before import)\n"
    );
  }

  await seedInitiatives();
  await seedResources();
  await seedRateStandards();
  await seedRates();
  await seedAllocations();
  await createCostView();

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
