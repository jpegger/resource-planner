import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import Papa from "papaparse";
import * as xlsx from "xlsx";

type SheetSpec = {
  sheetName: string;
  headerRow0: number; // 0-based
  outFilename: string;
  /** exact header list (in order) to emit */
  outHeaders: string[];
  /** transform a sheet row object into an output row keyed by outHeaders */
  mapRow: (row: Record<string, unknown>) => Record<string, string>;
  /**
   * Optional: transform the full list of sheet rows (after keepRow filter) to output rows.
   * Use this when output requires aggregation (e.g. Assignements merge by pair).
   */
  mapRows?: (rows: Record<string, unknown>[]) => Record<string, string>[];
  /** optional filter */
  keepRow?: (row: Record<string, unknown>) => boolean;
};

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dryRun") out["dryRun"] = true;
    else if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      // NOTE: `val` may legally be an empty string when passed as `--key ""` from npm scripts.
      // Only treat it as missing when it is truly absent or the next arg is another flag.
      if (val === undefined || val.startsWith("--")) {
        out[key] = "true";
      } else {
        out[key] = val;
        i++;
      }
    }
  }
  return out;
}

function trimToString(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Prefer SheetJS `w` (formatted text) over raw `v` so IDs and formula results match what Excel displays.
 * (Raw `v` can be 0 or empty for some formula/cache combinations; Rates/RESSOURCES MAT ids were affected.)
 */
function excelCellToString(cell: { w?: unknown; v?: unknown } | undefined): string {
  if (!cell) return "";
  const w = cell.w != null ? String(cell.w).trim() : "";
  if (w !== "") return w;
  if (cell.v == null) return "";
  return String(cell.v).trim();
}

/**
 * For “Percent assignement” only: prefer SheetJS raw `v` whenever it is a finite number.
 * Excel often shows a rounded `w` (“154%”) while `v` keeps binary float FTE (e.g. `1.54044` → 154.044%),
 * or rounds the other way (“13%” vs `0.125` → 12.5%). Other columns still use `excelCellToString`.
 */
function excelPercentAssignmentPreferStoredFraction(
  cell: { w?: unknown; v?: unknown } | undefined
): string {
  if (!cell) return "";
  const v = cell.v;
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return excelCellToString(cell);
}

function parseLooseNumber(raw: string): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/'/g, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .trim()
    .replace(",", ".");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map Excel "Percent assignement" **raw numeric** cell (no “%” in the formatted string we read) to
 * the 0–100 scale the seed expects (`parseNum` strips % then divides by 100 into FTE decimal).
 *
 * When the cell is stored/displayed with an explicit percent sign (e.g. `w` = "10%"), use the
 * parsed number as-is — see `formatPercentForSeed` / `percentStringTo0to100`.
 *
 * - `0.2`  → 20   (Excel fraction of 100%)
 * - `6`, `8` (whole integers 1–10) → 600, 800 (whole FTE; budget sheet stores “8” meaning 8 FTE)
 * - `20`, `50` (integers >10) → kept (already percent points, e.g. 20%)
 * - `1.54` → 154 (fractional FTE)
 * - `33.636363636` → same (percent-style decimals ≥10)
 */
function excelPercentCellToSeedPercentPoints(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n <= 1) return n * 100;
  const isIntegerLike = Math.abs(n - Math.round(n)) < 1e-6;
  // Whole numbers 1–10 are FTE in this workbook (6 = 6 FTE = 600%, not 6%).
  if (isIntegerLike && n >= 1 && n <= 10) return n * 100;
  if (isIntegerLike) return n;
  if (n < 10) return n * 100;
  return n;
}

/**
 * The seed expects Percent assignement as 0–100 scale with a trailing '%'
 * (it strips '%' and divides by 100).
 */
function formatPercentForSeed(v: unknown): string {
  const s = trimToString(v);
  if (!s) return "";
  if (s.includes("%")) {
    const n = parseLooseNumber(s);
    if (n === null) return s;
    // Display "10%" / "6%" is already 0–100 percent points — do not apply the 1–10 whole-FTE heuristic.
    return `${n.toFixed(9)}%`;
  }
  const n = parseLooseNumber(s);
  if (n === null) return s;
  const pct = excelPercentCellToSeedPercentPoints(n);
  return `${pct.toFixed(9)}%`;
}

function percentStringTo0to100(raw: string): number {
  const n = parseLooseNumber(raw);
  if (n === null) return 0;
  if (raw.includes("%")) return n;
  return excelPercentCellToSeedPercentPoints(n);
}

function formatPercent0to100(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "0.000000000%";
  return `${pct.toFixed(9)}%`;
}

function csvWriteWithExactHeaderLine(opts: {
  outPath: string;
  headerLine: string;
  headers: string[];
  rows: Record<string, string>[];
}): void {
  const body = Papa.unparse(opts.rows, {
    header: false,
    columns: opts.headers,
    quotes: false,
    skipEmptyLines: false,
  });
  const csv = opts.headerLine + "\n" + body + (body.endsWith("\n") ? "" : "\n");
  fs.writeFileSync(opts.outPath, csv, { encoding: "utf8" });
}

function sheetToObjects(
  wb: xlsx.WorkBook,
  sheetName: string,
  headerRow0: number,
  opts?: {
    /** Use stored numeric fraction for these columns instead of rounded formatted text */
    preferStoredFractionForHeader?: (header: string) => boolean;
  }
): Record<string, unknown>[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Missing sheet: ${sheetName}`);

  const range = xlsx.utils.decode_range(ws["!ref"] as string);
  const headerRow = headerRow0;

  const headers: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = xlsx.utils.encode_cell({ r: headerRow, c });
    const cell = ws[addr];
    headers.push(excelCellToString(cell));
  }

  const prefer = opts?.preferStoredFractionForHeader;

  const out: Record<string, unknown>[] = [];
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const obj: Record<string, unknown> = {};
    let any = false;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const key = headers[c - range.s.c];
      if (!key) continue;
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = ws[addr];
      const val = prefer?.(key)
        ? excelPercentAssignmentPreferStoredFraction(cell)
        : excelCellToString(cell);
      if (val !== "") any = true;
      obj[key] = val;
    }
    if (any) out.push(obj);
  }
  return out;
}

function findHeaderRow0ByCellValue(
  wb: xlsx.WorkBook,
  sheetName: string,
  wantedHeader: string,
  opts?: { maxScanRows?: number }
): number {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Missing sheet: ${sheetName}`);
  const range = xlsx.utils.decode_range(ws["!ref"] as string);
  const maxScan = opts?.maxScanRows ?? 15;
  const endRow = Math.min(range.e.r, range.s.r + maxScan);
  const wanted = wantedHeader.trim();

  for (let r = range.s.r; r <= endRow; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = xlsx.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (!cell) continue;
      const s = excelCellToString(cell);
      if (stripBom(s).trim() === wanted) return r;
    }
  }

  throw new Error(`Could not find header "${wantedHeader}" in sheet: ${sheetName}`);
}

function readReferenceHeaderLine(csvPath: string): string {
  const content = fs.readFileSync(csvPath, { encoding: "utf8" });
  // Keep raw header line exactly as stored in repo.
  return content.split(/\r?\n/)[0] ?? "";
}

function splitHeaderLine(headerLine: string): string[] {
  // Split by comma without trimming to preserve trailing spaces in header names.
  return headerLine.split(",");
}

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "");
}

/** Header on `(B) Assignements` for allocation % — may include a trailing space in CSV ref. */
function isPercentAssignmentSheetColumn(header: string): boolean {
  const h = stripBom(header).trim().toLowerCase();
  return h.startsWith("percent assignement") || h.startsWith("percent assignment");
}

function headerKey(headers: string[], wanted: string): string {
  const clean = (s: string) =>
    stripBom(s)
      .replace(/\u00A0/g, " ")
      .replace(/^"+/, "")
      .replace(/"+$/, "")
      .trim();
  const w = clean(wanted);
  const found =
    headers.find((h) => stripBom(h) === wanted) ??
    headers.find((h) => clean(h) === w);
  return found ?? wanted;
}

function buildRow(headers: string[], values: Record<string, string>): Record<string, string> {
  const clean = (s: string) =>
    stripBom(s)
      .replace(/\u00A0/g, " ")
      .replace(/^"+/, "")
      .replace(/"+$/, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  const valueByClean = new Map<string, string>();
  for (const [k, v] of Object.entries(values)) {
    valueByClean.set(clean(k), v);
  }

  const out: Record<string, string> = {};
  for (const h of headers) {
    out[h] = values[h] ?? valueByClean.get(clean(h)) ?? "";
  }
  return out;
}

function pick(row: Record<string, unknown>, keys: string[]): string {
  const normalize = (s: string): string =>
    stripBom(s)
      .replace(/\u00A0/g, " ")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      const v = row[k];
      const s = trimToString(v);
      if (s !== "") return s;
    }
  }

  const keyByNorm = new Map<string, string>();
  for (const actual of Object.keys(row)) {
    const n = normalize(actual);
    if (!keyByNorm.has(n)) keyByNorm.set(n, actual);
  }
  for (const wanted of keys) {
    const actual = keyByNorm.get(normalize(wanted));
    if (!actual) continue;
    const v = row[actual];
    const s = trimToString(v);
    if (s !== "") return s;
  }
  return "";
}

function normalizeResourceNameParts(row: Record<string, unknown>): {
  nom: string;
  prenom: string;
  fullName: string;
} {
  const nom = pick(row, ["Nom"]);
  const prenom = pick(row, ["Prénom"]);
  const fullName = pick(row, ["Full Name"]);
  // For some external roles, the sheet fills Prénom with a generic role (e.g. "Analyst Programmer")
  // and leaves Nom empty, while Full Name contains the real display name we want to preserve.
  if (!nom && fullName) {
    return { nom: fullName, prenom: "", fullName };
  }
  return { nom, prenom, fullName };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const input = (args["input"] as string) ?? "";
  if (!input) {
    throw new Error(
      "Missing --input. Pass the Excel workbook path explicitly, or set PROD_IMPORT_XLSX_PATH and run `npm run db:prod:generate-csv`."
    );
  }
  const outDir = (args["outDir"] as string) ?? "scripts/datasets/prod-import";
  const dryRun = Boolean(args["dryRun"]);

  const repoRoot = process.cwd();
  const refDir = path.join(repoRoot, "scripts", "datasets", "dev");

  const refAssignHeaderLine = readReferenceHeaderLine(path.join(refDir, "Assignement.csv"));
  const refResHeaderLine = readReferenceHeaderLine(path.join(refDir, "RESSOURCES.csv"));
  const refRatesHeaderLine = readReferenceHeaderLine(path.join(refDir, "RATES.csv"));
  const refRevHeaderLine = readReferenceHeaderLine(path.join(refDir, "REVENU.csv"));
  const refRateStandardHeaderLine = readReferenceHeaderLine(path.join(refDir, "RateStandard.csv"));
  const refJiraHeaderLine = readReferenceHeaderLine(path.join(refDir, "JIRA.csv"));
  const refEotpRoutingPath = path.join(refDir, "EOTP_ROUTING.csv");

  const refAssignHeaders = splitHeaderLine(refAssignHeaderLine);
  const refResHeaders = splitHeaderLine(refResHeaderLine);
  const refRatesHeaders = splitHeaderLine(refRatesHeaderLine);
  const refRevHeaders = splitHeaderLine(refRevHeaderLine);
  const refRateStandardHeaders = splitHeaderLine(refRateStandardHeaderLine);
  const refJiraHeaders = splitHeaderLine(refJiraHeaderLine);

  // Minimal sanity checks: non-empty header lists.
  if (refAssignHeaders.length < 5) throw new Error("Bad reference header: Assignement.csv");
  if (refResHeaders.length < 5) throw new Error("Bad reference header: RESSOURCES.csv");
  if (refRatesHeaders.length < 5) throw new Error("Bad reference header: RATES.csv");
  if (refRevHeaders.length < 5) throw new Error("Bad reference header: REVENU.csv");
  if (refRateStandardHeaders.length < 5) throw new Error("Bad reference header: RateStandard.csv");
  if (refJiraHeaders.length < 5) throw new Error("Bad reference header: JIRA.csv");

  const wb = xlsx.readFile(input, { raw: true, cellDates: false });
  const jiraHeaderRow0 = findHeaderRow0ByCellValue(wb, "(J) Initiative Export", "Key");
  const assignHeaderRow0 = findHeaderRow0ByCellValue(wb, "(B) Assignements", "RessourceId");

  const specs: SheetSpec[] = [
    {
      sheetName: "(J) Initiative Export",
      headerRow0: jiraHeaderRow0,
      outFilename: "JIRA.csv",
      outHeaders: refJiraHeaders,
      keepRow: (row) => {
        const key = pick(row, ["Key", "KEY", "Issue key", "Issue Key"]);
        return key !== "";
      },
      mapRow: (row) => {
        const H_Key = headerKey(refJiraHeaders, "Key");
        const H_Year = headerKey(refJiraHeaders, "(RI) Year");
        const H_ProductGroup = headerKey(refJiraHeaders, "(RI) Product Group");
        const H_Components = headerKey(refJiraHeaders, "Components");
        const H_Summary = headerKey(refJiraHeaders, "Summary");
        const H_Status = headerKey(refJiraHeaders, "Status");
        const H_Type = headerKey(refJiraHeaders, "(RI) Type");
        const H_Moscow = headerKey(refJiraHeaders, "(RI) MoSCoW");
        const H_Assignee = headerKey(refJiraHeaders, "Assignee");
        const H_Updated = headerKey(refJiraHeaders, "Updated");
        const H_Sap = headerKey(refJiraHeaders, "(RI) SAP PROGR. FIN.");
        const H_Total = headerKey(refJiraHeaders, "(RI) Total Cost EUR");
        const H_InternalEur = headerKey(refJiraHeaders, "(RI) Internal EUR");
        const H_InternalMd = headerKey(refJiraHeaders, "(RI) Internal Md");
        const H_ExternalEur = headerKey(refJiraHeaders, "(RI) External EUR");
        const H_ExternalMd = headerKey(refJiraHeaders, "(RI) External Md");
        const H_Other = headerKey(refJiraHeaders, "(RI) Other Costs EUR");
        const H_PreEur = headerKey(refJiraHeaders, "(RI) Pre-Analysis EUR");
        const H_PreMd = headerKey(refJiraHeaders, "(RI) Pre-Analysis Md");
        const H_Material = headerKey(refJiraHeaders, "(RI) Material Costs EUR");
        const H_EstInv = headerKey(refJiraHeaders, "(RI) Estimated Customer Invoice EUR");

        return buildRow(refJiraHeaders, {
          [H_Key]: pick(row, ["Key", "KEY", "Issue key", "Issue Key"]),
          [H_Year]: pick(row, ["(RI) Year", "RI Year", "Year", "(RI)Year"]),
          [H_ProductGroup]: pick(row, ["(RI) Product Group", "Product Group", "(RI)Product Group"]),
          [H_Components]: pick(row, ["Components", "Component", "Product (Component)"]),
          [H_Summary]: pick(row, ["Summary", "Issue summary", "Issue Summary"]),
          [H_Status]: pick(row, ["Status"]),
          [H_Type]: pick(row, ["(RI) Type", "Type", "RI Type"]),
          [H_Moscow]: pick(row, ["(RI) MoSCoW", "MoSCoW", "MOSCOW"]),
          [H_EstInv]: pick(row, ["(RI) Estimated Customer Invoice EUR", "Estimated Customer Invoice EUR"]),
          [H_ExternalEur]: pick(row, ["(RI) External EUR", "External EUR"]),
          [H_ExternalMd]: pick(row, ["(RI) External Md", "External Md", "External MD"]),
          [H_InternalEur]: pick(row, ["(RI) Internal EUR", "Internal EUR"]),
          [H_InternalMd]: pick(row, ["(RI) Internal Md", "Internal Md", "Internal MD"]),
          [H_Other]: pick(row, ["(RI) Other Costs EUR", "Other Costs EUR"]),
          [H_PreEur]: pick(row, ["(RI) Pre-Analysis EUR", "Pre-Analysis EUR", "Pre Analysis EUR"]),
          [H_PreMd]: pick(row, ["(RI) Pre-Analysis Md", "Pre-Analysis Md", "Pre Analysis Md"]),
          [H_Sap]: pick(row, ["(RI) SAP PROGR. FIN.", "SAP PROGR. FIN.", "SAP"]),
          [H_Total]: pick(row, ["(RI) Total Cost EUR", "Total Cost EUR"]),
          [H_Assignee]: pick(row, ["Assignee", "Owner", "Assignee Name"]),
          [H_Updated]: pick(row, ["Updated", "Last Updated"]),
          [H_Material]: pick(row, ["(RI) Material Costs EUR", "Material Costs EUR"]),
        });
      },
    },
    {
      sheetName: "(B) Assignements",
      headerRow0: assignHeaderRow0,
      outFilename: "Assignement.csv",
      outHeaders: refAssignHeaders,
      keepRow: (row) => {
        const resourceId = pick(row, ["RessourceId", "ResourceId", "Ressource ID", "Resource ID"]);
        const initiativeId = pick(row, ["InitiativeId", "Initiative ID", "Jira Key", "Key"]);
        return resourceId !== "" && initiativeId !== "";
      },
      mapRows: (rows) => {
        const H_Resource = headerKey(refAssignHeaders, "Resource");
        const H_Initiative = headerKey(refAssignHeaders, "Initiative");
        const H_Percent = headerKey(refAssignHeaders, "Percent assignement ");
        const H_ManDays = headerKey(refAssignHeaders, "Man Days Assignement");
        const H_RessourceId = headerKey(refAssignHeaders, "RessourceId");
        const H_InitiativeId = headerKey(refAssignHeaders, "InitiativeId");
        const H_ProductGroup = headerKey(refAssignHeaders, "Product Group");
        const H_ProductComponent = headerKey(refAssignHeaders, "Product (Component)");
        const H_Year = headerKey(refAssignHeaders, "Year");

        type Acc = {
          resourceId: string;
          initiativeId: string;
          resource: string;
          initiative: string;
          productGroup: string;
          productComponent: string;
          year: string;
          percentSum0to100: number;
          /** Sum of man-days across duplicate sheet rows for the same RessourceId×InitiativeId */
          manDaysSum: number;
        };

        const formatManDaysForCsv = (n: number): string => {
          if (!Number.isFinite(n) || n <= 0) return "";
          const rounded = Math.round(n * 100) / 100;
          return rounded % 1 === 0 ? rounded.toFixed(1) : String(rounded);
        };

        const accByPair = new Map<string, Acc>();
        for (const row of rows) {
          const resourceId = pick(row, ["RessourceId", "ResourceId", "Ressource ID", "Resource ID"]);
          const initiativeId = pick(row, ["InitiativeId", "Initiative ID", "Jira Key", "Key"]);
          const key = `${resourceId}\t${initiativeId}`;

          const percentRaw = pick(row, [
            "Percent assignement",
            "Percent assignement ",
            "Percent assignment",
            "Percent assignment ",
            "% assignement",
            "% assignment",
          ]);
          const percent0to100 = percentStringTo0to100(trimToString(percentRaw));

          const manDaysRaw = pick(row, [
            "Man Days Assignement",
            "Man Days Assignment",
            "Man Days",
            "Man-days",
            "Mandays",
          ]);
          const manDaysNum = parseLooseNumber(manDaysRaw);

          let acc = accByPair.get(key);
          if (!acc) {
            acc = {
              resourceId,
              initiativeId,
              resource: pick(row, ["Resource"]),
              initiative: pick(row, ["Initiative"]),
              productGroup: pick(row, ["Product Group"]),
              productComponent: pick(row, ["Product (Component)"]),
              year: pick(row, ["Year"]),
              percentSum0to100: 0,
              manDaysSum: 0,
            };
            accByPair.set(key, acc);
          }

          acc.percentSum0to100 += percent0to100;
          if (manDaysNum !== null && manDaysNum > 0) {
            acc.manDaysSum += manDaysNum;
          }
        }

        const out: Record<string, string>[] = [];
        for (const acc of accByPair.values()) {
          const pct = acc.percentSum0to100;
          out.push(
            buildRow(refAssignHeaders, {
              [H_Resource]: acc.resource,
              [H_Initiative]: acc.initiative,
              [H_Percent]: formatPercent0to100(pct),
              [H_ManDays]: formatManDaysForCsv(acc.manDaysSum),
              [H_RessourceId]: trimToString(acc.resourceId),
              [H_InitiativeId]: acc.initiativeId,
              [H_ProductGroup]: acc.productGroup,
              [H_ProductComponent]: acc.productComponent,
              [H_Year]: acc.year,
            })
          );
        }
        return out;
      },
      mapRow: (row) =>
        buildRow(refAssignHeaders, {
          [headerKey(refAssignHeaders, "Resource")]: pick(row, ["Resource"]),
          [headerKey(refAssignHeaders, "Initiative")]: pick(row, ["Initiative"]),
          [headerKey(refAssignHeaders, "Percent assignement ")]: formatPercentForSeed(
            pick(row, [
              "Percent assignement",
              "Percent assignement ",
              "Percent assignment",
              "Percent assignment ",
              "% assignement",
              "% assignment",
            ])
          ),
          [headerKey(refAssignHeaders, "Man Days Assignement")]: pick(row, [
            "Man Days Assignement",
            "Man Days Assignment",
            "Man Days",
            "Man-days",
            "Mandays",
          ]),
          [headerKey(refAssignHeaders, "RessourceId")]: pick(row, ["RessourceId", "ResourceId", "Ressource ID", "Resource ID"]),
          [headerKey(refAssignHeaders, "InitiativeId")]: pick(row, ["InitiativeId", "Initiative ID", "Jira Key", "Key"]),
          [headerKey(refAssignHeaders, "Product Group")]: pick(row, ["Product Group"]),
          [headerKey(refAssignHeaders, "Product (Component)")]: pick(row, ["Product (Component)"]),
          [headerKey(refAssignHeaders, "Year")]: pick(row, ["Year"]),
        }),
    },
    {
      sheetName: "(R) Ressources",
      headerRow0: 3,
      outFilename: "RESSOURCES.csv",
      outHeaders: refResHeaders,
      mapRow: (row) => {
        const parts = normalizeResourceNameParts(row);
        const H_Nom = headerKey(refResHeaders, "Nom");
        const H_Prenom = headerKey(refResHeaders, "Prénom");
        const H_Fonction = headerKey(refResHeaders, "Fonction");
        const H_Pole = headerKey(refResHeaders, "Pôle");
        const H_Cellule = headerKey(refResHeaders, "Cellule");
        const H_Groupe = headerKey(refResHeaders, "Groupe");
        const H_Type = headerKey(refResHeaders, "Internal or External");
        const H_Comment = headerKey(refResHeaders, "Comment");
        const H_FullName = headerKey(refResHeaders, "Full Name");
        const H_ID = headerKey(refResHeaders, "ID");
        const fullNameForId = parts.fullName || pick(row, ["Full Name"]);
        return buildRow(refResHeaders, {
          [H_Nom]: parts.nom,
          [H_Prenom]: parts.prenom,
          [H_Fonction]: pick(row, ["Fonction"]),
          [H_Pole]: pick(row, ["Pôle"]),
          [H_Cellule]: pick(row, ["Cellule"]),
          [H_Groupe]: pick(row, ["Groupe"]),
          [H_Type]: pick(row, ["Internal or External"]),
          [H_Comment]: pick(row, ["Comment"]),
          [H_FullName]: fullNameForId,
          [H_ID]: pick(row, ["ID"]),
        });
      },
    },
    {
      sheetName: "(R) Rates",
      headerRow0: 3,
      outFilename: "RATES.csv",
      outHeaders: refRatesHeaders,
      keepRow: (row) => {
        const name = pick(row, ["Name", "Name "]);
        // User-provided rule: filter out standard rates.
        if (name.toLowerCase().includes("standard rate")) return false;
        return true;
      },
      mapRow: (row) =>
        buildRow(refRatesHeaders, {
          "Name ": pick(row, ["Name", "Name "]),
          "Year": pick(row, ["Year"]),
          "Daily Cost ": pick(row, ["Daily Cost", "Daily Cost "]),
          "Nbr of Days per Year ": pick(row, ["Nbr of Days per Year", "Nbr of Days per Year "]),
          "Yearly Costs": pick(row, ["Yearly Costs"]),
          "RessourceId": pick(row, ["RessourceId"]),
          "RateId": pick(row, ["RateId"]),
        }),
    },
    {
      sheetName: "(R) Rates",
      headerRow0: 3,
      outFilename: "RateStandard.csv",
      outHeaders: refRateStandardHeaders,
      keepRow: (row) => {
        const name = pick(row, ["Name", "Name "]).toLowerCase();
        return name.includes("standard rate");
      },
      mapRow: (row) => {
        const name = pick(row, ["Name", "Name "]).toLowerCase();
        const isExternal = name.includes("external");
        const isInternal = name.includes("internal");
        const type = isExternal ? "External" : isInternal ? "Internal" : "Internal";
        return buildRow(refRateStandardHeaders, {
          "RateStandardPrimaryId": pick(row, ["RateId"]),
          "DailyRate": pick(row, ["Daily Cost", "Daily Cost "]),
          "IsInternalOrExternal": type,
          "NbrOfDaysPerYear": pick(row, ["Nbr of Days per Year", "Nbr of Days per Year "]),
          "Year": pick(row, ["Year"]),
          "Created On": "",
          "Modified On": "",
        });
      },
    },
    {
      sheetName: "(B) Revenues Assignments",
      headerRow0: 5,
      outFilename: "REVENU.csv",
      outHeaders: refRevHeaders,
      mapRow: (row) =>
        buildRow(refRevHeaders, {
          "Initiative": pick(row, ["Initiative"]),
          "Duplicates": pick(row, ["Duplicates"]),
          "Year": pick(row, ["Year"]),
          "Estimated Revenues": pick(row, ["Estimated Revenues"]),
          "Product Group": pick(row, ["Product Group"]),
          "Product (Component)": pick(row, ["Product (Component)"]),
          "Colonne1": pick(row, ["Colonne1"]),
          "Colonne2": pick(row, ["Colonne2"]),
          "Colonne3": pick(row, ["Colonne3"]),
          "Colonne4": pick(row, ["Colonne4"]),
          "Colonne5": pick(row, ["Colonne5"]),
          "Colonne6": pick(row, ["Colonne6"]),
          "Colonne7": pick(row, ["Colonne7"]),
          "Colonne8": pick(row, ["Colonne8"]),
          "Colonne9": pick(row, ["Colonne9"]),
          "Colonne10": pick(row, ["Colonne10"]),
          "Colonne11": pick(row, ["Colonne11"]),
          "Colonne12": pick(row, ["Colonne12"]),
          "Colonne13": pick(row, ["Colonne13"]),
          "Colonne14": pick(row, ["Colonne14"]),
          "Colonne15": pick(row, ["Colonne15"]),
        }),
    },
  ];

  fs.mkdirSync(outDir, { recursive: true });

  const summaries: { sheet: string; outFile: string; inRows: number; outRows: number }[] = [];

  for (const spec of specs) {
    const inRows = sheetToObjects(wb, spec.sheetName, spec.headerRow0, {
      preferStoredFractionForHeader: isPercentAssignmentSheetColumn,
    });
    const kept = spec.keepRow ? inRows.filter(spec.keepRow) : inRows;
    const outRows = spec.mapRows ? spec.mapRows(kept) : kept.map(spec.mapRow);
    const outPath = path.join(outDir, spec.outFilename);

    summaries.push({
      sheet: spec.sheetName,
      outFile: spec.outFilename,
      inRows: inRows.length,
      outRows: outRows.length,
    });

    if (!dryRun) {
      const headerLine =
        spec.outFilename === "JIRA.csv"
          ? refJiraHeaderLine
          : spec.outFilename === "Assignement.csv"
          ? refAssignHeaderLine
          : spec.outFilename === "RESSOURCES.csv"
          ? refResHeaderLine
          : spec.outFilename === "RATES.csv"
          ? refRatesHeaderLine
          : spec.outFilename === "RateStandard.csv"
          ? refRateStandardHeaderLine
          : refRevHeaderLine;
      csvWriteWithExactHeaderLine({
        outPath,
        headerLine,
        headers: spec.outHeaders,
        rows: outRows,
      });
    }
  }

  for (const s of summaries) {
    console.log(
      `${s.sheet} -> ${path.join(outDir, s.outFile)} (${s.inRows} rows -> ${s.outRows} rows)`
    );
  }

  // EOTP exception routing is not extracted from the workbook; prod seed loads it from
  // EOTP_ROUTING.csv (same layout as db:seed:routing). Copy the repo canonical file so
  // SEED_PROD_RESET runs repopulate eotp_routing instead of leaving it empty.
  if (!dryRun) {
    const routingOut = path.join(outDir, "EOTP_ROUTING.csv");
    if (fs.existsSync(refEotpRoutingPath)) {
      fs.copyFileSync(refEotpRoutingPath, routingOut);
      console.log(
        `EOTP routing -> ${path.join(outDir, "EOTP_ROUTING.csv")} (from ${path.relative(repoRoot, refEotpRoutingPath)})`
      );
    } else {
      console.warn(
        `⚠ No ${path.relative(repoRoot, refEotpRoutingPath)} — prod-import will have no EOTP_ROUTING.csv; ` +
          `db:seed:prod reset will skip eotp_routing unless you add that file.`
      );
    }
  }

  if (dryRun) {
    console.log("\n(dry run) no files written");
  }
}

main().catch((e) => {
  console.error("❌ xlsx-to-prod-data-auto failed:", e);
  process.exit(1);
});
