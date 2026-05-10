/**
 * POST local import APIs for realized-layer CSVs (design: calude-design/claude_realized-costs-revenue-design.md).
 *
 * Requires `next dev` or `next start` on IMPORT_API_BASE_URL (default http://127.0.0.1:3000).
 *
 * Usage:
 *   npx tsx scripts/import-realized-csv.ts ar --year 2025
 *   npx tsx scripts/import-realized-csv.ts timesheets --year 2025
 *   npx tsx scripts/import-realized-csv.ts invoices --year 2025
 *   npx tsx scripts/import-realized-csv.ts revenue --year 2025
 *   npx tsx scripts/import-realized-csv.ts all --year 2025
 *
 * Env:
 *   REALIZED_EXPORT_DIR — folder with SAP/SN/SF CSVs (Windows path OK under WSL /mnt/c/...).
 *   IMPORT_API_BASE_URL — default http://127.0.0.1:3000
 *
 * Flags:
 *   --year <int>        metadata year for import (default: calendar year).
 *   --file <path>       override CSV path for the single command (not with `all`).
 *   --export-dir <path> override REALIZED_EXPORT_DIR for this run.
 *   --base-url <url>    override IMPORT_API_BASE_URL.
 */

import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_EXPORT =
  "/mnt/c/Users/jegger/Paradigm/CRPS_Customer Relation Product & Strategy-Budget - Documents/Budget/DataExport";

type Kind = "timesheets" | "invoices" | "ar" | "revenue";

const ROUTES: Record<Kind, string> = {
  timesheets: "/api/imports/timesheets",
  invoices: "/api/imports/invoices",
  ar: "/api/imports/ar",
  revenue: "/api/imports/revenue",
};

function defaultFile(kind: Kind, year: number): string {
  switch (kind) {
    case "timesheets":
      return `SN_Time_Card_Export_${year}.csv`;
    case "invoices":
      return "SAP_VIM_Factures_Fournisseurs.csv";
    case "ar":
      return "SalesForce_AR_export_Corrected.csv";
    case "revenue":
      return "SAP_Clients_Invoices.csv";
  }
}

function parseArgs(): {
  cmd: string;
  year: number;
  file: string | null;
  exportDir: string;
  baseUrl: string;
} {
  const argv = process.argv.slice(2);
  const cmd = (argv[0] ?? "help").toLowerCase();
  let year = new Date().getFullYear();
  let file: string | null = null;
  let exportDir = process.env["REALIZED_EXPORT_DIR"]?.trim() || DEFAULT_EXPORT;
  let baseUrl = process.env["IMPORT_API_BASE_URL"]?.trim() || "http://127.0.0.1:3000";

  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--year" && argv[i + 1]) {
      year = Number.parseInt(argv[i + 1]!, 10);
      i++;
    } else if (a === "--file" && argv[i + 1]) {
      file = argv[i + 1]!;
      i++;
    } else if (a === "--export-dir" && argv[i + 1]) {
      exportDir = argv[i + 1]!;
      i++;
    } else if (a === "--base-url" && argv[i + 1]) {
      baseUrl = argv[i + 1]!.replace(/\/$/, "");
      i++;
    }
  }

  if (!Number.isFinite(year) || year < 1990 || year > 2100) {
    console.error("Invalid --year");
    process.exit(1);
  }

  return { cmd, year, file, exportDir, baseUrl };
}

async function postMultipart(url: string, filePath: string, year: number): Promise<Response> {
  const buf = fs.readFileSync(filePath);
  const name = path.basename(filePath);
  const blob = new Blob([buf], { type: "text/csv" });
  const form = new FormData();
  form.set("year", String(year));
  form.set("file", blob, name);
  return fetch(url, { method: "POST", body: form });
}

async function runOne(
  kind: Kind,
  year: number,
  filePath: string,
  baseUrl: string
): Promise<void> {
  const url = `${baseUrl}${ROUTES[kind]}`;
  console.log(`→ POST ${url}`);
  console.log(`   file: ${filePath}`);
  console.log(`   year: ${year}`);
  const res = await postMultipart(url, filePath, year);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    body = text;
  }
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) {
    console.error(`HTTP ${res.status}`);
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/import-realized-csv.ts <timesheets|invoices|ar|revenue|all> [options]

Options:
  --year <int>         Import year (default: current calendar year)
  --file <path>        Full path to CSV (single command only)
  --export-dir <path>  Directory containing default filenames (${DEFAULT_EXPORT})
  --base-url <url>     API origin (default http://127.0.0.1:3000 or IMPORT_API_BASE_URL)

Env: REALIZED_EXPORT_DIR, IMPORT_API_BASE_URL

Default files per command:
  timesheets → SN_Time_Card_Export_<year>.csv
  invoices   → SAP_VIM_Factures_Fournisseurs.csv
  ar         → SalesForce_AR_export_Corrected.csv
  revenue    → SAP_Clients_Invoices.csv
`);
}

async function main(): Promise<void> {
  const { cmd, year, file, exportDir, baseUrl } = parseArgs();

  if (cmd === "help" || cmd === "-h" || cmd === "--help") {
    printHelp();
    return;
  }

  const kinds: Kind[] =
    cmd === "all" ? ["timesheets", "invoices", "ar", "revenue"] : ([cmd] as Kind[]);

  if (kinds.some((k) => !["timesheets", "invoices", "ar", "revenue"].includes(k))) {
    printHelp();
    process.exit(1);
  }

  if (cmd === "all" && file) {
    console.error("--file cannot be used with `all`");
    process.exit(1);
  }

  for (const kind of kinds) {
    const csvPath = file ? path.resolve(file) : path.join(exportDir, defaultFile(kind, year));
    if (!fs.existsSync(csvPath)) {
      console.error(`Missing file: ${csvPath}`);
      process.exit(1);
    }
    await runOne(kind, year, csvPath, baseUrl);
    console.log("");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
