/**
 * One-off / repeatable: convert legacy EOTP_ROUTING.csv (costType, valueType, value)
 * to the simplified format (internal, external, direct EUR per row).
 *
 * Requires DATABASE_URL and v_allocation_costs (run db:view:prod or seed views first).
 *
 * Usage: npx tsx scripts/convert-eotp-routing-csv.ts [path/to/EOTP_ROUTING.csv]
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

type LegacyRow = {
  productName: string;
  eotp: string;
  eopLabel: string;
  year: string;
  costType: string;
  valueType: string;
  value: string;
  comment: string;
};

type Merged = {
  productName: string;
  eotp: string;
  eopLabel: string;
  year: number;
  internal: number;
  external: number;
  direct: number;
  comments: string[];
};

function normalizeEopLabel(label: string): string {
  return label.trim().replace(/Plateforme Commune/gi, "Plateforme commune");
}

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

function routedEur(
  costType: string,
  valueType: string,
  value: number,
  totals: { internal: number; external: number; direct: number }
): { internal: number; external: number; direct: number } {
  const z = { internal: 0, external: 0, direct: 0 };
  const pct = valueType.trim().toLowerCase() === "percent";
  const v = value;
  const ct = costType.trim();
  if (ct === "Internal Costs") {
    z.internal = pct ? totals.internal * (v / 100) : v;
  } else if (ct === "External Costs") {
    z.external = pct ? totals.external * (v / 100) : v;
  } else if (ct === "Direct Costs") {
    z.direct = pct ? totals.direct * (v / 100) : v;
  }
  return z;
}

async function main(): Promise<void> {
  const inPath =
    process.argv[2] ?? path.join(__dirname, "data-prod", "EOTP_ROUTING.csv");
  if (!fs.existsSync(inPath)) {
    console.error(`Missing file: ${inPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(inPath, { encoding: "utf-8" }).replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true });
  const raw = (parsed.data ?? []).filter((r) => r && typeof r === "object");

  if (raw.length === 0) {
    console.error("CSV has no rows.");
    process.exit(1);
  }

  const headers = Object.keys(raw[0] ?? {});
  const isNewFormat =
    headers.includes("internal") && headers.includes("external") && headers.includes("direct");

  if (isNewFormat) {
    console.log("CSV already uses internal/external/direct columns. Nothing to do.");
    return;
  }

  const costs = await loadCostsByProductYear();

  const groups = new Map<string, Merged>();

  for (const row of raw as unknown as LegacyRow[]) {
    const productName = (row.productName ?? "").trim();
    const eotp = (row.eotp ?? "").trim();
    const year = Number.parseInt((row.year ?? "").trim(), 10);
    if (!productName || !eotp || Number.isNaN(year)) continue;

    const key = `${productName.toLowerCase()}\t${year}\t${eotp}`;
    const totals = costs.get(`${productName.toLowerCase()}\t${year}`) ?? {
      internal: 0,
      external: 0,
      direct: 0,
    };

    const value = Number.parseFloat(String(row.value ?? "").replace(",", "."));
    if (Number.isNaN(value) || value === 0) continue;

    const add = routedEur(row.costType ?? "", row.valueType ?? "", value, totals);
    if (add.internal === 0 && add.external === 0 && add.direct === 0) continue;

    const existing = groups.get(key);
    const comment = (row.comment ?? "").trim();
    if (existing) {
      existing.internal += add.internal;
      existing.external += add.external;
      existing.direct += add.direct;
      if (comment) existing.comments.push(comment);
      if (!existing.eopLabel && row.eopLabel) existing.eopLabel = normalizeEopLabel(row.eopLabel);
    } else {
      groups.set(key, {
        productName,
        eotp,
        eopLabel: normalizeEopLabel(row.eopLabel ?? ""),
        year,
        internal: add.internal,
        external: add.external,
        direct: add.direct,
        comments: comment ? [comment] : [],
      });
    }
  }

  const out = [...groups.values()].sort((a, b) => {
    const p = a.productName.localeCompare(b.productName);
    if (p !== 0) return p;
    if (a.year !== b.year) return a.year - b.year;
    return a.eotp.localeCompare(b.eotp);
  });

  const csv = Papa.unparse(
    out.map((r) => ({
      productName: r.productName,
      eotp: r.eotp,
      eopLabel: r.eopLabel,
      year: r.year,
      internal: r.internal,
      external: r.external,
      direct: r.direct,
      comment: r.comments.join("; "),
    })),
    {
      columns: ["productName", "eotp", "eopLabel", "year", "internal", "external", "direct", "comment"],
    }
  );

  fs.writeFileSync(inPath, csv + "\n", { encoding: "utf-8" });
  console.log(`Wrote ${out.length} merged rows to ${path.relative(process.cwd(), inPath)}`);
}

main()
  .catch((e) => {
    console.error("❌ Convert failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
