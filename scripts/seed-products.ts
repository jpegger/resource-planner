/**
 * Upserts products from `scripts/data-prod/PRODUCTS.csv`.
 *
 * Usage: `npm run db:seed:products`
 *
 * Run **`npm run db:seed:eotp`** first so `eotp_definition` exists; this script links
 * `allocation_entity.eotp_definition_id` from SAP code / label.
 *
 * Run before production initiative seed so `allocationEntityId` can resolve from Components.
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import fs from "fs";
import path from "path";
import Papa from "papaparse";

import { linkAllocationEntitiesToEotpDefinitions } from "../src/lib/eotp-definition-resolve";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

interface ProductRow {
  id: string;
  name: string;
  productFamily: string;
  division: string;
  subDivision: string;
  team: string;
  sapEotpCode: string;
  sapEotpName: string;
  attractiveness: string;
  competitiveness: string;
}

function nullableStr(val: string): string | null {
  const t = val.trim();
  return t === "" ? null : t;
}

function nullableFloat(val: string): number | null {
  const t = val.trim();
  if (t === "") return null;
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

async function main(): Promise<void> {
  const filePath = path.join(__dirname, "data-prod", "PRODUCTS.csv");
  if (!fs.existsSync(filePath)) {
    console.error(`Missing: ${path.relative(process.cwd(), filePath)}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = Papa.parse<ProductRow>(raw, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
  });

  const rows = (parsed.data as ProductRow[]).filter((row) => row.id?.trim());

  console.log(`Importing ${rows.length} allocation entities…`);

  for (const row of rows) {
    await prisma.allocationEntity.upsert({
      where: { id: row.id.trim() },
      create: {
        id: row.id.trim(),
        name: row.name.trim(),
        productFamily: nullableStr(row.productFamily ?? ""),
        division: nullableStr(row.division ?? ""),
        subDivision: nullableStr(row.subDivision ?? ""),
        team: nullableStr(row.team ?? ""),
        sapEotpCode: nullableStr(row.sapEotpCode ?? ""),
        sapEotpName: nullableStr(row.sapEotpName ?? ""),
        attractiveness: nullableFloat(row.attractiveness ?? ""),
        competitiveness: nullableFloat(row.competitiveness ?? ""),
      },
      update: {
        name: row.name.trim(),
        productFamily: nullableStr(row.productFamily ?? ""),
        division: nullableStr(row.division ?? ""),
        subDivision: nullableStr(row.subDivision ?? ""),
        team: nullableStr(row.team ?? ""),
        sapEotpCode: nullableStr(row.sapEotpCode ?? ""),
        sapEotpName: nullableStr(row.sapEotpName ?? ""),
        attractiveness: nullableFloat(row.attractiveness ?? ""),
        competitiveness: nullableFloat(row.competitiveness ?? ""),
      },
    });
  }

  console.log(`Done. ${rows.length} allocation entities upserted.`);

  await linkAllocationEntitiesToEotpDefinitions(prisma);
  console.log("Linked allocation_entity.eotp_definition_id from SAP code / label.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
