/**
 * Upserts canonical EOTP rows from `scripts/data-prod/EOTP-Budget-Owner.csv`.
 *
 * Columns: Division, Budget Owner, Director, SubDivision, Team, Prog Fin (SAP code), Prog Fin lib (label).
 *
 * Usage: `npm run db:seed:eotp`
 *
 * Run after `npm run db:migrate` and before `npm run db:seed:products` so allocation entities
 * can resolve `eotp_definition_id` (or run `npm run db:seed:products` which re-links FKs).
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import fs from "fs";
import path from "path";
import Papa from "papaparse";

const adapter = new PrismaPg({
  connectionString: process.env["DATABASE_URL"] as string,
});
const prisma = new PrismaClient({ adapter });

const DATA_DIR = path.join(__dirname, "data-prod");
const FILE = "EOTP-Budget-Owner.csv";

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

function nullable(raw: string): string | null {
  const t = raw.trim();
  return t === "" ? null : t;
}

async function main(): Promise<void> {
  const filePath = path.join(DATA_DIR, FILE);
  if (!fs.existsSync(filePath)) {
    console.error(`Missing: ${path.relative(process.cwd(), filePath)}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const cleaned = raw.replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(cleaned, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.replace(/^\uFEFF/, "").trim(),
  });

  const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");
  let upserted = 0;
  const seen = new Set<string>();

  for (const row of rows) {
    const division = nullable(trimStr(row["Division"]));
    const budgetOwner = nullable(trimStr(row["Budget Owner"]));
    const director = nullable(trimStr(row["Director"]));
    const subDivision = nullable(trimStr(row["SubDivision"]));
    const team = nullable(trimStr(row["Team"]));
    const code = trimStr(row["Prog Fin"]);
    let label = trimStr(row["Prog Fin lib"]);

    if (!code) continue;
    if (!label) label = code;

    const dedupeKey = `${code.toLowerCase()}\0${label.toLowerCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    await prisma.eotpDefinition.upsert({
      where: {
        sapEotpCode_label: {
          sapEotpCode: code,
          label,
        },
      },
      create: {
        sapEotpCode: code,
        label,
        division,
        budgetOwner,
        director,
        subDivision,
        team,
      },
      update: {
        division,
        budgetOwner,
        director,
        subDivision,
        team,
      },
    });
    upserted++;
  }

  console.log(`Done. ${upserted} EOTP definition row(s) upserted from ${FILE}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
