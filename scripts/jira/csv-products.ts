import fs from "node:fs";

import Papa from "papaparse";

export type CsvProductRow = {
  id: string;
  name: string;
  productFamily: string | null;
  division: string | null;
  subDivision: string | null;
  team: string | null;
  sapEotpCode: string | null;
  sapEotpName: string | null;
  attractiveness: number | null;
  competitiveness: number | null;
};

function parseNullableFloat(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const x = Number.parseFloat(s.replace(",", "."));
  return Number.isFinite(x) ? x : null;
}

function normalizeNullableString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

export function readCsvProducts(csvPath: string): { products: CsvProductRow[]; invalidRows: Array<{ row: unknown; reason: string }> } {
  const raw = fs.readFileSync(csvPath, "utf8");
  const parsed = Papa.parse<Record<string, unknown>>(raw, { header: true, skipEmptyLines: true });

  const invalidRows: Array<{ row: unknown; reason: string }> = [];
  const products: CsvProductRow[] = [];

  for (const row of parsed.data ?? []) {
    const id = normalizeNullableString(row.id);
    const name = normalizeNullableString(row.name);
    if (!id) {
      invalidRows.push({ row, reason: "missing id" });
      continue;
    }
    if (!name) {
      invalidRows.push({ row, reason: "missing name" });
      continue;
    }

    products.push({
      id,
      name,
      productFamily: normalizeNullableString(row.productFamily),
      division: normalizeNullableString(row.division),
      subDivision: normalizeNullableString(row.subDivision),
      team: normalizeNullableString(row.team),
      sapEotpCode: normalizeNullableString(row.sapEotpCode),
      sapEotpName: normalizeNullableString(row.sapEotpName),
      attractiveness: parseNullableFloat(row.attractiveness),
      competitiveness: parseNullableFloat(row.competitiveness),
    });
  }

  return { products, invalidRows };
}

