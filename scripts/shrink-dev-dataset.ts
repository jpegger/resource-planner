import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import Papa from "papaparse";

import { PrismaClient } from "../src/generated/prisma/client";

type CsvRow = Record<string, string>;

const repoRoot = process.cwd();
const devDir = path.join(repoRoot, "scripts", "datasets", "dev");
const outDir = path.join(repoRoot, "scripts", "datasets", "dev-min");

function readCsv(filePath: string): CsvRow[] {
  const raw = fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<CsvRow>(raw, { header: true, skipEmptyLines: true });
  return (parsed.data as CsvRow[]).filter((r) => r && typeof r === "object");
}

function writeCsv(filePath: string, rows: CsvRow[], headerOrder: string[]): void {
  const csv = Papa.unparse(rows, { columns: headerOrder });
  fs.writeFileSync(filePath, csv + "\n", "utf-8");
}

function normalizeId(raw: string): string {
  return raw.replace(/\s/g, "").trim();
}

function extractResourceIdFromRow(row: CsvRow): string {
  const direct = (row["ID"] ?? row["ID_1"] ?? row["Id"] ?? row["id"] ?? "").toString();
  const normalizedDirect = normalizeId(direct);
  if (normalizedDirect) return normalizedDirect;

  // Fallback: some CSV rows can be slightly malformed (misquoted commas), so scan values.
  for (const v of Object.values(row)) {
    const m = (v ?? "").toString().match(/MAT-\d{7}/);
    if (m?.[0]) return m[0];
  }
  return "";
}

function readFixtureProductYears(): Map<string, Set<number>> {
  const fxPath = path.join(repoRoot, "tests", "fixtures", "expected-costs.csv");
  const rows = readCsv(fxPath);
  const out = new Map<string, Set<number>>();
  for (const r of rows) {
    const productId = (r["product_id"] ?? "").trim();
    const year = Number.parseInt((r["year"] ?? "").trim(), 10);
    if (!productId || !Number.isFinite(year)) continue;
    const s = out.get(productId) ?? new Set<number>();
    s.add(year);
    out.set(productId, s);
  }
  return out;
}

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) {
    throw new Error("DATABASE_URL is not set (needed to compute minimal dataset).");
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const productYears = readFixtureProductYears();
  const productIds = [...productYears.keys()];
  const neededYears = new Set<number>(
    [...productYears.values()].flatMap((s) => [...s])
  );

  const productsPath = path.join(devDir, "PRODUCTS.csv");
  const products = readCsv(productsPath);
  const productIdToComponent = new Map<string, string>();
  for (const p of products) {
    const id = (p["id"] ?? "").trim();
    const name = (p["name"] ?? "").trim();
    if (id && name) productIdToComponent.set(id, name);
  }

  const keepComponents = new Set(
    productIds
      .map((id) => productIdToComponent.get(id))
      .filter((x): x is string => !!x)
      .map((x) => x.trim().toLowerCase())
  );

  // We derive required initiatives from JIRA.csv itself (not from current DB state)
  // to keep this script repeatable and aligned with what seed-production ingests.
  const jiraPath = path.join(devDir, "JIRA.csv");
  const jiraRaw = fs.readFileSync(jiraPath, { encoding: "latin1" }).replace(/^\uFEFF/, "");
  const jiraParsed = Papa.parse<CsvRow>(jiraRaw, { header: true, skipEmptyLines: true });
  const jiraRows = (jiraParsed.data as CsvRow[]).filter((r) => r && typeof r === "object");

  const keepJiraRows: CsvRow[] = [];
  const keepInitiativeIds = new Set<string>();
  for (const r of jiraRows) {
    const id = (r["Key"] ?? "").trim();
    const year = Number.parseInt((r["(RI) Year"] ?? "").trim(), 10);
    if (!id || !Number.isFinite(year) || !neededYears.has(year)) continue;
    const componentValues = [
      r["Components"],
      r["Components_1"],
      r["Components_2"],
      r["Components_3"],
    ]
      .map((v) => (v ?? "").trim())
      .filter(Boolean)
      .map((v) => v.toLowerCase());
    const matches = componentValues.some((c) => keepComponents.has(c));
    if (!matches) continue;
    keepJiraRows.push(r);
    keepInitiativeIds.add(id);
  }

  fs.mkdirSync(outDir, { recursive: true });

  const assignmentPath = path.join(devDir, "Assignement.csv");
  const assignmentRaw = fs.readFileSync(assignmentPath, "utf-8").replace(/^\uFEFF/, "");
  const assignmentParsed = Papa.parse<CsvRow>(assignmentRaw, { header: true, skipEmptyLines: true });
  const assignmentRows = (assignmentParsed.data as CsvRow[]).filter((r) => r && typeof r === "object");

  const keepAssignments: CsvRow[] = [];
  const keepResourceIds = new Set<string>();
  const keepResourceIdsNormalized = new Set<string>();
  for (const r of assignmentRows) {
    const initiativeId = (r["InitiativeId"] ?? "").trim();
    if (!keepInitiativeIds.has(initiativeId)) continue;
    keepAssignments.push(r);
    const resourceId = (r["RessourceId"] ?? "").trim();
    if (resourceId) {
      keepResourceIds.add(resourceId);
      keepResourceIdsNormalized.add(normalizeId(resourceId));
    }
  }

  const ressourcesPath = path.join(devDir, "RESSOURCES.csv");
  // For RESSOURCES.csv we avoid parse→unparse, because a single malformed line can
  // shift columns and lose the ID in the output (causing seedResources() to skip it).
  // ID is the last column, so we can filter at the line level safely.
  const ressourcesRaw = fs.readFileSync(ressourcesPath, "utf-8").replace(/^\uFEFF/, "");
  const ressourcesLines = ressourcesRaw.split(/\r?\n/).filter(Boolean);
  const ressourcesHeader = ressourcesLines[0] ?? "";
  const keepRessourcesLines: string[] = [];
  for (const line of ressourcesLines.slice(1)) {
    const last = line.split(",").at(-1) ?? "";
    const id = normalizeId(last);
    if (!id) continue;
    if (!keepResourceIdsNormalized.has(id)) continue;
    keepRessourcesLines.push(line);
  }

  const ratesPath = path.join(devDir, "RATES.csv");
  const ratesRaw = fs.readFileSync(ratesPath, "utf-8").replace(/^\uFEFF/, "");
  const ratesParsed = Papa.parse<CsvRow>(ratesRaw, { header: true, skipEmptyLines: true });
  const rateRows = (ratesParsed.data as CsvRow[]).filter((r) => r && typeof r === "object");
  const keepRates = rateRows.filter((r) => {
    const resourceId = (r["RessourceId"] ?? "").trim();
    if (!keepResourceIdsNormalized.has(normalizeId(resourceId))) return false;
    const year = Number.parseInt((r["Year"] ?? "").trim(), 10);
    return Number.isFinite(year) && neededYears.has(year);
  });

  // Revenue is not required for SQL fixture tests; keep header-only so the file exists.
  const revenuePath = path.join(outDir, "REVENU.csv");
  const revenueHeader =
    "Initiative,Duplicates,Year,Estimated Revenues,Product Group,Product (Component),Colonne1,Colonne2,Colonne3,Colonne4,Colonne5,Colonne6,Colonne7,Colonne8,Colonne9,Colonne10,Colonne11,Colonne12,Colonne13,Colonne14,Colonne15\n";
  fs.writeFileSync(revenuePath, revenueHeader, "utf-8");

  // Preserve original column order from source files.
  const assignmentHeaders = (assignmentParsed.meta.fields ?? []) as string[];
  const ratesHeaders = (ratesParsed.meta.fields ?? []) as string[];

  writeCsv(path.join(outDir, "JIRA.csv"), keepJiraRows, (jiraParsed.meta.fields ?? []) as string[]);
  fs.copyFileSync(path.join(devDir, "PRODUCTS.csv"), path.join(outDir, "PRODUCTS.csv"));
  fs.copyFileSync(path.join(devDir, "RateStandard.csv"), path.join(outDir, "RateStandard.csv"));
  fs.copyFileSync(path.join(devDir, "EOTP-Budget-Owner.csv"), path.join(outDir, "EOTP-Budget-Owner.csv"));
  fs.copyFileSync(path.join(devDir, "EOTP_ROUTING.csv"), path.join(outDir, "EOTP_ROUTING.csv"));

  writeCsv(path.join(outDir, "Assignement.csv"), keepAssignments, assignmentHeaders);
  fs.writeFileSync(
    path.join(outDir, "RESSOURCES.csv"),
    [ressourcesHeader, ...keepRessourcesLines, ""].join("\n"),
    "utf-8"
  );
  writeCsv(path.join(outDir, "RATES.csv"), keepRates, ratesHeaders);

  await prisma.$disconnect();

  console.log(
    JSON.stringify(
      {
        keepInitiatives: keepInitiativeIds.size,
        keepAssignments: keepAssignments.length,
        keepRessources: keepRessourcesLines.length,
        keepRates: keepRates.length,
        revenue: "header-only",
      },
      null,
      2
    )
  );
}

void main();

