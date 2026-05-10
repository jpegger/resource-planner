/**
 * From a Salesforce AR export (semicolon CSV), collect unique Master Product names,
 * fuzzy-match them to rows in scripts/datasets/dev/EOTP-Budget-Owner.csv (Prog Fin lib / Team),
 * then resolve allocation_entity_id via scripts/datasets/dev/PRODUCTS.csv (sapEotpCode = Prog Fin).
 *
 * Usage:
 *   npx tsx scripts/build-sf-master-product-mapping-suggestions.ts --arCsv /path/to/SalesForce_AR_export_Corrected.csv
 *
 * Outputs (repo-relative):
 *   scripts/datasets/dev/sf_master_product_mapping_suggestions.csv
 *   scripts/datasets/dev/sf_master_product_mapping_suggestions.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "csv-parse/sync";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_AR =
  "/mnt/c/Users/jegger/Paradigm/CRPS_Customer Relation Product & Strategy-Budget - Documents/Budget/DataExport/SalesForce_AR_export_Corrected.csv";
const EOTP_CSV = path.join(REPO_ROOT, "scripts/datasets/dev/EOTP-Budget-Owner.csv");
const PRODUCTS_CSV = path.join(REPO_ROOT, "scripts/datasets/dev/PRODUCTS.csv");

const MASTER_COL = "Price Book Entry: Product: Master Product: Product Name";

type ProductRow = {
  id: string;
  name: string;
  sapEotpCode: string;
  sapEotpName: string;
};

type EotpRow = {
  progFin: string;
  progFinLib: string;
  team: string;
  division: string;
  subDivision: string;
};

type Suggestion = {
  sfMasterProductName: string;
  displayStem: string;
  matchScore: number;
  confidence: "high" | "medium" | "low" | "ambiguous" | "none";
  eotpProgFin: string;
  eotpProgFinLib: string;
  eotpTeam: string;
  allocationEntityId: string | null;
  allocationEntityName: string | null;
  notes: string;
};

function parseArgs(): { arCsv: string } {
  const argv = process.argv.slice(2);
  let arCsv = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--arCsv" && argv[i + 1]) {
      arCsv = argv[i + 1]!;
      i++;
    }
  }
  if (!arCsv) arCsv = process.env["SF_AR_CORRECTED_CSV"]?.trim() || DEFAULT_AR;
  return { arCsv };
}

function norm(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[_\-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripMasterPrefix(name: string): string {
  return name.replace(/^_m-/i, "").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[] = Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j]! + 1, dp[j - 1]! + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n]!;
}

function scorePair(a: string, b: string): number {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.95;
  const d = levenshtein(A, B);
  const denom = Math.max(A.length, B.length, 1);
  return Math.max(0, 1 - d / denom);
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter(Boolean));
  const tb = new Set(norm(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

function combinedScore(master: string, candidate: string): number {
  return Math.max(scorePair(master, candidate), scorePair(stripMasterPrefix(master), candidate), tokenJaccard(master, candidate));
}

function trimRecord(r: Record<string, string>): Record<string, string> {
  const o: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    o[k.trim()] = (v ?? "").trim();
  }
  return o;
}

function loadEotpRows(): EotpRow[] {
  const raw = fs.readFileSync(EOTP_CSV, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<
    string,
    string
  >[];
  const out: EotpRow[] = [];
  for (const rec of rows) {
    const r = trimRecord(rec);
    const progFin = r["Prog Fin"] ?? "";
    const progFinLib = r["Prog Fin lib"] ?? "";
    if (!progFin && !progFinLib) continue;
    out.push({
      progFin: progFin.replace(/\s/g, ""),
      progFinLib,
      team: r["Team"] ?? "",
      division: r["Division"] ?? "",
      subDivision: r["SubDivision"] ?? "",
    });
  }
  return out;
}

function loadProducts(): ProductRow[] {
  const raw = fs.readFileSync(PRODUCTS_CSV, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  const out: ProductRow[] = [];
  for (const rec of rows) {
    const id = (rec["id"] ?? "").trim();
    const name = (rec["name"] ?? "").trim();
    const sapEotpCode = (rec["sapEotpCode"] ?? "").trim();
    const sapEotpName = (rec["sapEotpName"] ?? "").trim();
    if (!id) continue;
    out.push({ id, name, sapEotpCode, sapEotpName });
  }
  return out;
}

function uniqueMasterProducts(arPath: string): string[] {
  const raw = fs.readFileSync(arPath, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<
    string,
    string
  >[];
  const set = new Set<string>();
  for (const rec of rows) {
    const r = trimRecord(rec);
    const v = (r[MASTER_COL] ?? "").trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function bestEotpForMaster(master: string, eotpRows: EotpRow[]): { row: EotpRow; score: number; secondScore: number } {
  let best: EotpRow | null = null;
  let bestScore = 0;
  let second = 0;
  for (const row of eotpRows) {
    const targets = [
      row.progFinLib,
      `${row.team} ${row.progFinLib}`,
      row.progFin,
      `${row.subDivision} ${row.progFinLib}`,
    ];
    let s = 0;
    for (const t of targets) {
      s = Math.max(s, combinedScore(master, t));
    }
    if (s > bestScore) {
      second = bestScore;
      bestScore = s;
      best = row;
    } else if (s > second) {
      second = s;
    }
  }
  if (!best) {
    return { row: { progFin: "", progFinLib: "", team: "", division: "", subDivision: "" }, score: 0, secondScore: 0 };
  }
  return { row: best, score: bestScore, secondScore: second };
}

function pickProductForProgFin(
  progFin: string,
  master: string,
  products: ProductRow[]
): { id: string | null; name: string | null; productScore: number } {
  const code = progFin.replace(/\s/g, "").toUpperCase();
  const candidates = products.filter((p) => p.sapEotpCode.replace(/\s/g, "").toUpperCase() === code);
  if (candidates.length === 0) return { id: null, name: null, productScore: 0 };
  let bestId: string | null = null;
  let bestName: string | null = null;
  let best = 0;
  for (const p of candidates) {
    const s = Math.max(combinedScore(master, p.name), combinedScore(master, p.sapEotpName), combinedScore(stripMasterPrefix(master), p.name));
    if (s > best) {
      best = s;
      bestId = p.id;
      bestName = p.name;
    }
  }
  return { id: bestId, name: bestName, productScore: best };
}

function confidenceFor(score: number, second: number, hasProduct: boolean): Suggestion["confidence"] {
  if (score < 0.35) return "none";
  if (score >= 0.82 && second < score - 0.08) return "high";
  if (score >= 0.62 && second < score - 0.05) return "medium";
  if (second >= score - 0.04 && score >= 0.5) return "ambiguous";
  if (!hasProduct) return "low";
  return "low";
}

function escapeCsvCell(s: string): string {
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main() {
  const { arCsv } = parseArgs();
  if (!fs.existsSync(arCsv)) {
    console.error(`AR CSV not found: ${arCsv}`);
    process.exit(1);
  }
  if (!fs.existsSync(EOTP_CSV)) {
    console.error(`EOTP CSV not found: ${EOTP_CSV}`);
    process.exit(1);
  }
  if (!fs.existsSync(PRODUCTS_CSV)) {
    console.error(`PRODUCTS CSV not found: ${PRODUCTS_CSV}`);
    process.exit(1);
  }

  const masters = uniqueMasterProducts(arCsv);
  const eotpRows = loadEotpRows();
  const products = loadProducts();

  const suggestions: Suggestion[] = [];

  for (const master of masters) {
    const { row: e, score, secondScore } = bestEotpForMaster(master, eotpRows);
    const { id: aeId, name: aeName, productScore } = pickProductForProgFin(e.progFin, master, products);
    const hasProduct = Boolean(aeId);
    const conf = confidenceFor(score, secondScore, hasProduct);
    const notes = [
      `fuzzyScore=${score.toFixed(3)} second=${secondScore.toFixed(3)}`,
      `eotpProgFin=${e.progFin || "—"} lib=${e.progFinLib || "—"}`,
      aeId ? `productPickScore=${productScore.toFixed(3)} → ${aeName} (${aeId})` : "no PRODUCTS row for Prog Fin code",
    ].join("; ");

    suggestions.push({
      sfMasterProductName: master,
      displayStem: stripMasterPrefix(master),
      matchScore: score,
      confidence: conf,
      eotpProgFin: e.progFin,
      eotpProgFinLib: e.progFinLib,
      eotpTeam: e.team,
      allocationEntityId: aeId,
      allocationEntityName: aeName,
      notes,
    });
  }

  const outDir = path.join(REPO_ROOT, "scripts/datasets/dev");
  const jsonPath = path.join(outDir, "sf_master_product_mapping_suggestions.json");
  const csvPath = path.join(outDir, "sf_master_product_mapping_suggestions.csv");

  fs.writeFileSync(jsonPath, JSON.stringify({ sourceArCsv: arCsv, generatedAt: new Date().toISOString(), suggestions }, null, 2), "utf8");

  const header = [
    "sf_master_product_name",
    "sf_master_product_key",
    "allocation_entity_id",
    "notes",
    "confidence",
    "match_score",
    "eotp_prog_fin",
    "eotp_prog_fin_lib",
  ];
  const lines = [
    header.join(","),
    ...suggestions.map((s) =>
      [
        escapeCsvCell(s.sfMasterProductName),
        "",
        s.allocationEntityId ? escapeCsvCell(s.allocationEntityId) : "",
        escapeCsvCell(s.notes),
        s.confidence,
        s.matchScore.toFixed(4),
        escapeCsvCell(s.eotpProgFin),
        escapeCsvCell(s.eotpProgFinLib),
      ].join(",")
    ),
  ];
  fs.writeFileSync(csvPath, lines.join("\n") + "\n", "utf8");

  console.log(`Unique master products: ${masters.length}`);
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${csvPath}`);
  const amb = suggestions.filter((s) => s.confidence === "ambiguous" || s.confidence === "none" || !s.allocationEntityId);
  if (amb.length) {
    console.log(`\nReview (${amb.length} rows need attention):`);
    for (const s of amb.slice(0, 20)) {
      console.log(`  - ${s.sfMasterProductName} [${s.confidence}] → ${s.eotpProgFinLib || "?"} (${s.notes})`);
    }
    if (amb.length > 20) console.log(`  … and ${amb.length - 20} more`);
  }
}

main();
