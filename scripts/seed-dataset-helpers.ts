/**
 * Shared CSV path resolution for dataset seeds (`SEED_DATASET_DIR` → prod-import → dev).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const PROD_IMPORT_DIR = path.join(__dirname, "datasets", "prod-import");
const DEV_DATASET_DIR = path.join(__dirname, "datasets", "dev");

/** Same order as `seed-production.ts` `resolveCsvPath`. */
export function resolveDatasetCsvPath(filename: string): string {
  const seedDir = process.env["SEED_DATASET_DIR"]
    ? path.resolve(process.cwd(), process.env["SEED_DATASET_DIR"])
    : null;
  const strict =
    process.env["SEED_STRICT_DATASET"] === "1" || process.env["SEED_STRICT_DATASET"] === "true";

  if (seedDir) {
    const p = path.join(seedDir, filename);
    if (fs.existsSync(p)) return p;
  }
  const prod = path.join(PROD_IMPORT_DIR, filename);
  if (fs.existsSync(prod)) return prod;
  if (strict) return prod;
  return path.join(DEV_DATASET_DIR, filename);
}
