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
      if (!val || val.startsWith("--")) {
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
  return stripBom(header).trim().startsWith("Percent assignement");
}

function headerKey(headers: string[], wanted: string): string {
  const found = headers.find((h) => stripBom(h) === wanted);
  return found ?? wanted;
}

function buildRow(headers: string[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) out[h] = values[h] ?? "";
  return out;
}

function pick(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(row, k)) {
      const v = row[k];
      const s = trimToString(v);
      if (s !== "") return s;
    }
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
  const input =
    (args["input"] as string) ??
    "/mnt/c/Users/jegger/Paradigm/CRPS_Customer Relation Product & Strategy-Budget - Documents/Budget/Paradigm_Financials_Budget_v2.2_16.11.20241.xlsx";
  const outDir = (args["outDir"] as string) ?? "scripts/datasets/prod-import";
  const dryRun = Boolean(args["dryRun"]);

  const repoRoot = process.cwd();
  const refDir = path.join(repoRoot, "scripts", "datasets", "dev");

  const refAssignHeaderLine = readReferenceHeaderLine(path.join(refDir, "Assignement.csv"));
  const refResHeaderLine = readReferenceHeaderLine(path.join(refDir, "RESSOURCES.csv"));
  const refRatesHeaderLine = readReferenceHeaderLine(path.join(refDir, "RATES.csv"));
  const refRevHeaderLine = readReferenceHeaderLine(path.join(refDir, "REVENU.csv"));

  const refAssignHeaders = splitHeaderLine(refAssignHeaderLine);
  const refResHeaders = splitHeaderLine(refResHeaderLine);
  const refRatesHeaders = splitHeaderLine(refRatesHeaderLine);
  const refRevHeaders = splitHeaderLine(refRevHeaderLine);

  // Minimal sanity checks: non-empty header lists.
  if (refAssignHeaders.length < 5) throw new Error("Bad reference header: Assignement.csv");
  if (refResHeaders.length < 5) throw new Error("Bad reference header: RESSOURCES.csv");
  if (refRatesHeaders.length < 5) throw new Error("Bad reference header: RATES.csv");
  if (refRevHeaders.length < 5) throw new Error("Bad reference header: REVENU.csv");

  const wb = xlsx.readFile(input, { raw: true, cellDates: false });

  const specs: SheetSpec[] = [
    {
      sheetName: "(B) Assignements",
      headerRow0: 3,
      outFilename: "Assignement.csv",
      outHeaders: refAssignHeaders,
      keepRow: (row) => {
        const resourceId = pick(row, ["RessourceId"]);
        const initiativeId = pick(row, ["InitiativeId"]);
        return resourceId !== "" && initiativeId !== "";
      },
      mapRows: (rows) => {
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
          const resourceId = pick(row, ["RessourceId"]);
          const initiativeId = pick(row, ["InitiativeId"]);
          const key = `${resourceId}\t${initiativeId}`;

          const percentRaw = pick(row, ["Percent assignement", "Percent assignement "]);
          const percent0to100 = percentStringTo0to100(trimToString(percentRaw));

          const manDaysRaw = pick(row, ["Man Days Assignement"]);
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
              "Resource": acc.resource,
              "Initiative": acc.initiative,
              "Percent assignement ": formatPercent0to100(pct),
              "Man Days Assignement": formatManDaysForCsv(acc.manDaysSum),
              "RessourceId": trimToString(acc.resourceId),
              "InitiativeId": acc.initiativeId,
              "Product Group": acc.productGroup,
              "Product (Component)": acc.productComponent,
              "Year": acc.year,
            })
          );
        }
        return out;
      },
      mapRow: (row) =>
        buildRow(refAssignHeaders, {
          "Resource": pick(row, ["Resource"]),
          "Initiative": pick(row, ["Initiative"]),
          "Percent assignement ": formatPercentForSeed(
            pick(row, ["Percent assignement", "Percent assignement "])
          ),
          "Man Days Assignement": pick(row, ["Man Days Assignement"]),
          "RessourceId": pick(row, ["RessourceId"]),
          "InitiativeId": pick(row, ["InitiativeId"]),
          "Product Group": pick(row, ["Product Group"]),
          "Product (Component)": pick(row, ["Product (Component)"]),
          "Year": pick(row, ["Year"]),
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
        spec.outFilename === "Assignement.csv"
          ? refAssignHeaderLine
          : spec.outFilename === "RESSOURCES.csv"
            ? refResHeaderLine
            : spec.outFilename === "RATES.csv"
              ? refRatesHeaderLine
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

  if (dryRun) {
    console.log("\n(dry run) no files written");
  }
}

main().catch((e) => {
  console.error("❌ xlsx-to-prod-data-auto failed:", e);
  process.exit(1);
});
