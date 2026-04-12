import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadCsv<T extends Record<string, string>>(filename: string): T[] {
  const filePath = path.resolve(__dirname, filename);
  const content = fs.readFileSync(filePath, "utf-8");
  const rows = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as T[];
  // Strip BOM if the file was saved as "CSV UTF-8" from Excel (header becomes \ufeffproduct_id).
  return rows.map((row) => {
    const out = {} as T;
    for (const [k, v] of Object.entries(row)) {
      const key = k.replace(/^\uFEFF/, "").trim() as keyof T & string;
      out[key] = v;
    }
    return out;
  });
}

export function toNum(value: string): number {
  return parseFloat(value);
}

export function toBool(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}
