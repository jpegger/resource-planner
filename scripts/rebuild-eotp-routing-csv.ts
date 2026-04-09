/**
 * Rebuild scripts/data-prod/EOTP_ROUTING.csv from the original wide routing export.
 *
 * Input CSV columns (expected headers):
 * Product,SAP Programme de Financement,Year,Assignement Type,
 * Percent assignement  1_Budget_0624_Besoins,Ammount Assignement  1_Budget_0624_Besoins,
 * Percent assignement  Now,Ammount Assignement Now,OTP,Comment
 *
 * Output CSV columns:
 * productName,eotp,eopLabel,year,internal,external,direct,comment
 *
 * Business rules:
 * - Only store exceptions in EOTP_ROUTING.csv.
 * - Default mapping (no rows) means 100% flows to Product.sapEotpCode.
 * - Keep rows where target EOTP != product.sapEotpCode.
 * - If there are multiple routing rows for the same product×year×costType, keep ALL of them,
 *   including the main EOTP row (explicit split case).
 * - Ignore rows with Assignement Type = "All Costs".
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

type SourceRow = Record<string, string>;

type OutRow = {
  productName: string;
  eotp: string;
  eopLabel: string;
  year: number;
  costType: "Internal Costs" | "External Costs" | "Direct Costs";
  valueType: "percent" | "amount";
  value: number;
  comment: string;
};

function parseSwissNumber(raw: string): number | null {
  const v = (raw ?? "").trim();
  if (!v || v === "-" || v === "-   ") return null;
  const cleaned = v
    .replace(/'/g, "")
    .replace(/%/g, "")
    .replace(/\s/g, "")
    .trim();
  const n = Number.parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

function pickValue(row: SourceRow): { valueType: OutRow["valueType"]; value: number } | null {
  const pNow = parseSwissNumber(row["Percent assignement  Now"]);
  if (pNow !== null && pNow !== 0) return { valueType: "percent", value: pNow };

  const aNow = parseSwissNumber(row["Ammount Assignement Now"]);
  if (aNow !== null && aNow !== 0) return { valueType: "amount", value: aNow };

  const p1 = parseSwissNumber(row["Percent assignement  1_Budget_0624_Besoins"]);
  if (p1 !== null && p1 !== 0) return { valueType: "percent", value: p1 };

  const a1 = parseSwissNumber(row["Ammount Assignement  1_Budget_0624_Besoins"]);
  if (a1 !== null && a1 !== 0) return { valueType: "amount", value: a1 };

  return null;
}

function norm(s: string): string {
  return (s ?? "").trim();
}

/** Same spelling as Jira components (e.g. `7D0043002 - CRM_Plateforme commune`): lowercase "commune". */
function normalizeEopLabel(label: string): string {
  return norm(label).replace(/Plateforme Commune/gi, "Plateforme commune");
}

function costTypeOrNull(raw: string): OutRow["costType"] | null {
  const v = norm(raw);
  if (v === "Internal Costs" || v === "External Costs" || v === "Direct Costs") return v;
  if (v === "All Costs") return null;
  return null;
}

type WideRow = {
  productName: string;
  eotp: string;
  eopLabel: string;
  year: number;
  internal: number;
  external: number;
  direct: number;
  comment: string;
};

async function loadCostsByProductYear(): Promise<
  Map<string, { internal: number; external: number; direct: number }>
> {
  const rows = await prisma.$queryRaw<
    { name: string; year: number; internal_cost: number; external_cost: number; direct_cost: number }[]
  >`
    SELECT
      p.name AS name,
      i.year AS year,
      COALESCE(SUM(v.internal_cost), 0)::double precision AS internal_cost,
      COALESCE(SUM(v.external_cost), 0)::double precision AS external_cost,
      COALESCE(SUM(v.direct_cost), 0)::double precision AS direct_cost
    FROM product p
    JOIN initiative i ON i."productId" = p.id
    JOIN v_allocation_costs v ON v.jira_key = i.id
    GROUP BY p.name, i.year
  `;
  const m = new Map<string, { internal: number; external: number; direct: number }>();
  for (const r of rows) {
    m.set(`${r.name.trim().toLowerCase()}\t${r.year}`, {
      internal: Number(r.internal_cost),
      external: Number(r.external_cost),
      direct: Number(r.direct_cost),
    });
  }
  return m;
}

function mergeToWide(
  narrow: OutRow[],
  costs: Map<string, { internal: number; external: number; direct: number }>
): WideRow[] {
  const groups = new Map<
    string,
    {
      productName: string;
      eotp: string;
      eopLabel: string;
      year: number;
      internal: number;
      external: number;
      direct: number;
      comments: string[];
    }
  >();

  for (const r of narrow) {
    const key = `${r.productName.toLowerCase()}\t${r.year}\t${r.eotp}`;
    const totals = costs.get(`${r.productName.toLowerCase()}\t${r.year}`) ?? {
      internal: 0,
      external: 0,
      direct: 0,
    };
    const pct = r.valueType === "percent";
    const v = r.value;
    let addInt = 0;
    let addExt = 0;
    let addDir = 0;
    if (r.costType === "Internal Costs") {
      addInt = pct ? totals.internal * (v / 100) : v;
    } else if (r.costType === "External Costs") {
      addExt = pct ? totals.external * (v / 100) : v;
    } else {
      addDir = pct ? totals.direct * (v / 100) : v;
    }
    if (addInt === 0 && addExt === 0 && addDir === 0) continue;

    const existing = groups.get(key);
    const c = (r.comment ?? "").trim();
    if (existing) {
      existing.internal += addInt;
      existing.external += addExt;
      existing.direct += addDir;
      if (c) existing.comments.push(c);
      if (!existing.eopLabel && r.eopLabel) existing.eopLabel = r.eopLabel;
    } else {
      groups.set(key, {
        productName: r.productName,
        eotp: r.eotp,
        eopLabel: r.eopLabel,
        year: r.year,
        internal: addInt,
        external: addExt,
        direct: addDir,
        comments: c ? [c] : [],
      });
    }
  }

  const merged = [...groups.values()].sort((a, b) => {
    const pa = a.productName.localeCompare(b.productName);
    if (pa !== 0) return pa;
    if (a.year !== b.year) return a.year - b.year;
    return a.eotp.localeCompare(b.eotp);
  });

  return merged.map((m) => ({
    productName: m.productName,
    eotp: m.eotp,
    eopLabel: m.eopLabel,
    year: m.year,
    internal: m.internal,
    external: m.external,
    direct: m.direct,
    comment: m.comments.join("; "),
  }));
}

async function main(): Promise<void> {
  const sourcePath =
    process.env["EOTP_ROUTING_SOURCE"] ??
    path.join(__dirname, "data-prod", "EOTP_ROUTING_SOURCE.csv");
  const outPath = path.join(__dirname, "data-prod", "EOTP_ROUTING.csv");

  if (!fs.existsSync(sourcePath)) {
    console.error(
      `Missing source CSV. Put your original export at ${path.relative(
        process.cwd(),
        sourcePath
      )} (or set EOTP_ROUTING_SOURCE=/path/to/file.csv)`
    );
    process.exit(1);
  }

  const content = fs.readFileSync(sourcePath, { encoding: "utf-8" }).replace(/^\uFEFF/, "");
  const parsed = Papa.parse<SourceRow>(content, { header: true, skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");

  const products = await prisma.allocationEntity.findMany({
    select: { id: true, name: true, sapEotpCode: true, sapEotpName: true },
  });
  const byName = new Map(products.map((p) => [p.name.trim().toLowerCase(), p]));

  const prelim: (OutRow & { mainEotp: string | null })[] = [];
  let skipped = 0;

  for (const row of rows) {
    const productName = norm(row["Product"]);
    if (!productName) {
      skipped++;
      continue;
    }

    const prod = byName.get(productName.toLowerCase());
    if (!prod) {
      // Product not in catalog → cannot decide what's "standard"
      skipped++;
      continue;
    }

    const year = Number.parseInt(norm(row["Year"]), 10);
    if (Number.isNaN(year)) {
      skipped++;
      continue;
    }

    const ct = costTypeOrNull(row["Assignement Type"]);
    if (!ct) continue; // ignore All Costs and unknown types

    const eotp = norm(row["OTP"]);
    if (!eotp) {
      skipped++;
      continue;
    }

    const val = pickValue(row);
    if (!val) {
      skipped++;
      continue;
    }

    prelim.push({
      productName,
      eotp,
      eopLabel: normalizeEopLabel(norm(row["SAP Programme de Financement"])),
      year,
      costType: ct,
      valueType: val.valueType,
      value: val.value,
      comment: norm(row["Comment"]),
      mainEotp: prod.sapEotpCode ?? null,
    });
  }

  // Group by product×year×costType so we can keep explicit splits (multiple rows)
  const keyOf = (r: OutRow & { mainEotp: string | null }) => `${r.productName}\t${r.year}\t${r.costType}`;
  const groups = new Map<string, (OutRow & { mainEotp: string | null })[]>();
  for (const r of prelim) {
    const key = keyOf(r);
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }

  const out: OutRow[] = [];

  for (const g of groups.values()) {
    const multiple = g.length > 1;
    for (const r of g) {
      // Keep all if explicit split (multiple rows)
      if (multiple) {
        out.push(r);
        continue;
      }

      // Single-row case: only keep if it's routing away from main EOTP
      const main = (r.mainEotp ?? "").trim();
      if (!main || r.eotp !== main) {
        out.push(r);
      }
    }
  }

  out.sort((a, b) => {
    const pa = a.productName.localeCompare(b.productName);
    if (pa !== 0) return pa;
    const ya = a.year - b.year;
    if (ya !== 0) return ya;
    const ca = a.costType.localeCompare(b.costType);
    if (ca !== 0) return ca;
    return a.eotp.localeCompare(b.eotp);
  });

  const costs = await loadCostsByProductYear();
  const wide = mergeToWide(out, costs);

  const csv = Papa.unparse(wide, {
    columns: ["productName", "eotp", "eopLabel", "year", "internal", "external", "direct", "comment"],
  });

  fs.writeFileSync(outPath, csv + "\n", { encoding: "utf-8" });

  console.log(
    `Done. Wrote ${wide.length} merged rows to ${path.relative(process.cwd(), outPath)} (narrow ${out.length}, skipped ${skipped}).`
  );
}

main()
  .catch((e) => {
    console.error("❌ Rebuild failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

