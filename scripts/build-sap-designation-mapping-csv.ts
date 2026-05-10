/**
 * Builds `scripts/datasets/dev/SAP_DESIGNATION_MAPPING.csv` from:
 * 1. Distinct `revenue_entry.product_label` rows whose import warning starts with
 *    "Designation not matched" (when DATABASE_URL is set), OR
 * 2. A bundled fallback list (same shape as a typical post-import backlog), OR
 * 3. Existing rows already present in `SAP_DESIGNATION_MAPPING.csv` (union of keys).
 *
 * Each row is matched to an `allocation_entity.id` (PRD-*) using explicit overrides
 * first, then UC/_UC suffix stripping, then substring overlap against `PRODUCTS.csv`.
 *
 * `sf_product_name` is filled from the canonical Salesforce product list in
 * `scripts/data/sf-product-names.ts` using fuzzy scoring (see
 * `SAP_DESIGNATION_FUZZY_REPORT.md` generated alongside the CSV).
 *
 * Run: `npx dotenv -e .env -- npx tsx scripts/build-sap-designation-mapping-csv.ts`
 */
import * as fs from "node:fs";
import * as path from "node:path";
import Papa from "papaparse";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { SF_PRODUCT_NAMES } from "./data/sf-product-names";
import { resolveDatasetCsvPath } from "./seed-dataset-helpers";

const OUT = path.join(__dirname, "datasets", "dev", "SAP_DESIGNATION_MAPPING.csv");
const FUZZY_REPORT = path.join(__dirname, "datasets", "dev", "SAP_DESIGNATION_FUZZY_REPORT.md");

type ProductRow = { id: string; name: string };

/** High-confidence hand maps (SAP designation text → PRD-*). */
const OVERRIDES: Record<string, { id: string; sfProductName?: string; notes?: string }> = {
  "CRM UC": {
    id: "PRD-CRM",
    sfProductName: "CRM - Use Case",
    notes: "Canonical SF name; AR resolver step-2 retry uses this column",
  },
  "CRM Framework": {
    id: "PRD-CRM",
    sfProductName: "CRM Framework",
    notes: "Canonical SF name matches AR line item label",
  },
  "CRM_Org": { id: "PRD-CRM", notes: "CRM organisation / org charting" },
  "CRM_Org dédiée": { id: "PRD-CRM", notes: "Dedicated CRM org" },
  "NOVA_UC": {
    id: "PRD-NOVA",
    sfProductName: "NOVA use case",
    notes: "Same UC pattern as CRM UC → NOVA catalogue product",
  },
  "NOVA_R": { id: "PRD-NOVA", notes: "NOVA recurring / R-line" },
  "DataHub UC": {
    id: "PRD-DATA_HUB",
    sfProductName: "DATA HUB use case",
    notes: "DataHub UC → DATA HUB (plateforme)",
  },
  "DataHub Framework": { id: "PRD-DATA_HUB", notes: "Data hub framework" },
  "HMS UC": { id: "PRD-HMS", sfProductName: "HMS use case", notes: "HMS use-case billing" },
  "BOS_Framework": {
    id: "PRD-BOS",
    sfProductName: "BOS - Foundation",
    notes: "BOS framework component",
  },
  "BOS_Session": { id: "PRD-BOS", notes: "BOS session consumption" },
  "BOS_UC": { id: "PRD-BOS", sfProductName: "BOS - Use Case", notes: "BOS UC" },
  "BOS_Xchange": { id: "PRD-XCHANGE_BOS", notes: "xCHANGE (BOS) product line" },
  "eSign Framework": { id: "PRD-ESIGN", notes: "eSIGN framework" },
  "eSign Connecteur": { id: "PRD-ESIGN" },
  "eSign Connecteur Sharepoint maintenance": { id: "PRD-ESIGN" },
  "eSign Rest-Api Support": { id: "PRD-ESIGN" },
  "eSign StarterKit": { id: "PRD-ESIGN" },
  "eSign Token": { id: "PRD-ESIGN" },
  "FaaS Add-on Consume": { id: "PRD-FAAS", notes: "FaaS add-on consumption" },
  "FaaS Rack": { id: "PRD-FAAS", notes: "FaaS rack" },
  "IRISbox Portail": { id: "PRD-IRISBOX", notes: "IRISbox portal" },
  "IRISbox_UC": { id: "PRD-IRISBOX", sfProductName: "IRISbox use case" },
  "SharedHost": { id: "PRD-SWH", notes: "Shared web hosting (SWH)" },
  "vDC": { id: "PRD-VDC" },
  "vDC Add-on Consume": { id: "PRD-VDC", notes: "vDC add-on" },
  "Assistance 365": { id: "PRD-MS365_ASSISTANCE_365" },
  "365 Assistance": { id: "PRD-MS365_ASSISTANCE_365", notes: "Same as Assistance 365 wording variant" },
  "Expertise_365": { id: "PRD-MS365_EXPERTISE_MS365" },
  "Implementation and Setup 365": { id: "PRD-MS365_ONBOARDING", notes: "REVIEW: onboarding vs generic MS365" },
  "Intranet 365_Maintenance": { id: "PRD-MS365_INTRANET" },
  "Audit sécurité_365": { id: "PRD-MS365_SECURITY" },
  "Gestion Intune Tenant dédié": { id: "PRD-MS365_INTUNE" },
  "DataCatalog DataBase": { id: "PRD-DATA_CATALOG" },
  "DataCatalog Manager": { id: "PRD-DATA_CATALOG" },
  "DataCatalog Technology": { id: "PRD-DATA_CATALOG" },
  "DataGov Support": { id: "PRD-DATA_GOV" },
  "DataGov Support - annulation 6000000966": { id: "PRD-DATA_GOV", notes: "Cancelled line; same product bucket" },
  "DataStore": { id: "PRD-DATASTORE" },
  "FIDUS": { id: "PRD-FIDUS" },
  // NOTE: `DPOaaS-*` (C/B, C/M, F/*, H/*, M/*) and `DPO - Analysis` already match
  // an AR `sf_product_name` exactly, so step 1 of the resolver handles them with
  // no mapping row. Only the bare `DPOaaS` (no variant) and `DPO Analysis` (vs
  // SF "DPO - Analysis") need an entry here for the SAP-only / wording-variant cases.
  "DPOaaS": {
    id: "PRD-DPO_IS",
    sfProductName: "",
    notes: "SAP-only generic line — no DPOaaS variant on SF; allocation only (step 2)",
  },
  "DPO Analysis": {
    id: "PRD-DPO_IS",
    sfProductName: "DPO - Analysis",
    notes: "SAP omits the dash; map to canonical SF name for AR step-2 retry",
  },
  "DNS Agent": { id: "PRD-DNS" },
  "DNS free": { id: "PRD-DNS" },
  "DNS Agent - annul 6000000655 du 25092025": { id: "PRD-DNS", notes: "Cancellation line" },
  "MyAccess-Citizen": { id: "PRD-MYACCESS" },
  "MyPermit UC Enviro": { id: "PRD-MYPERMIT_ENVIRONNEMENT", sfProductName: "MyPermit use case (env.)" },
  "MyPermit UC Urbanisme": { id: "PRD-MYPERMIT_URBAN", sfProductName: "MyPermit use case (urban)" },
  "VPN_Connect": { id: "PRD-VPN" },
  "VPN unmanaged": { id: "PRD-VPN" },
  "VPN xFA Set-up": { id: "PRD-VPN" },
  "VPS": { id: "PRD-VPS" },
  "ISP M": { id: "PRD-ISP", notes: "ISP managed" },
  "ITSM licence basic": { id: "PRD-SN_ITSM", notes: "SN ITSM licence" },
  "SInCrHo_H": { id: "PRD-SINCRHO", notes: "SINCHRO hosting line" },
  "Soft HR Framework": { id: "PRD-SOFT_HR" },
  "Soft HR UC": { id: "PRD-SOFT_HR", sfProductName: "Soft HR use case" },
  "Managed server in VDC": { id: "PRD-VDC" },
  "Managed server in a local network": {
    id: "PRD-SMS",
    notes: "REVIEW: could be SWH; picked Servers Managed Service",
  },
  "BUonline 4XL": { id: "PRD-BUO", notes: "BU online / backup online family" },
  "ITassist_T1": {
    id: "PRD-AMS",
    notes: "REVIEW: AMS as managed-service proxy for ITassist tier-1 billing",
  },
  "vDC - annule 6000000649 du 25.09.2025": { id: "PRD-VDC", notes: "Cancellation; same product" },
  "vDC - annule 6000000651 du 25.09.2025": { id: "PRD-VDC", notes: "Cancellation; same product" },
  "vDC - annule 6000000653 du 25.09.2025": { id: "PRD-VDC", notes: "Cancellation; same product" },
  "Digital Transformation by EA": {
    id: "PRD-INNOVATION",
    notes: "REVIEW: enterprise architecture / transformation bucket",
  },
  "DataMaturityAssessment Large": {
    id: "PRD-DATA_GOV",
    notes: "REVIEW: data governance / maturity; confirm with finance",
  },
  "Consultance Expertise": {
    id: "PRD-AMS",
    notes: "REVIEW: consulting expertise → AMS default",
  },
  "FMS_UC": {
    id: "PRD-WEPULSE_FIN",
    sfProductName: "Financial management use case",
    notes: "REVIEW: FMS assumed WePulse FIN; confirm with controlling",
  },
  "ISACoaching": {
    id: "PRD-CYBER_SECURITY",
    notes: "REVIEW: ISA coaching → security portfolio",
  },
  "ISA Missions": {
    id: "PRD-CYBER_SECURITY",
    notes: "REVIEW: ISA missions → security portfolio",
  },
  "Workplace Essential": {
    id: "PRD-MS365_TENANT_REGIONAL",
    notes: "REVIEW: BX365 / tenant bundle naming from SAP Workplace",
  },
  "Workplace Extended": {
    id: "PRD-MS365_TENANT_REGIONAL",
    notes: "REVIEW: BX365 / tenant bundle naming from SAP Workplace",
  },
  "Workplace O365/E3": {
    id: "PRD-MS365_LICENCES",
    notes: "REVIEW: O365 E3 licence line",
  },
};

const FALLBACK_DESIGNATIONS = [
  "365 Assistance",
  "Assistance 365",
  "Audit sécurité_365",
  "BOS_Framework",
  "BOS_Session",
  "BOS_UC",
  "BOS_Xchange",
  "BUonline 4XL",
  "Consultance Expertise",
  "CRM Framework",
  "CRM_Org",
  "CRM_Org dédiée",
  "CRM UC",
  "DataCatalog DataBase",
  "DataCatalog Manager",
  "DataCatalog Technology",
  "DataGov Support",
  "DataGov Support - annulation 6000000966",
  "DataHub Framework",
  "DataHub UC",
  "DataMaturityAssessment Large",
  "DataStore",
  "Digital Transformation by EA",
  "DNS Agent",
  "DNS Agent - annul 6000000655 du 25092025",
  "DNS free",
  "DPOaaS",
  "DPO Analysis",
  "eSign Connecteur",
  "eSign Connecteur Sharepoint maintenance",
  "eSign Framework",
  "eSign Rest-Api Support",
  "eSign StarterKit",
  "eSign Token",
  "Expertise_365",
  "FaaS Add-on Consume",
  "FaaS Rack",
  "FIDUS",
  "FMS_UC",
  "Gestion Intune Tenant dédié",
  "HMS UC",
  "Implementation and Setup 365",
  "Intranet 365_Maintenance",
  "IRISbox Portail",
  "IRISbox_UC",
  "ISACoaching",
  "ISA Missions",
  "ISP M",
  "ITassist_T1",
  "ITSM licence basic",
  "Managed server in a local network",
  "Managed server in VDC",
  "MyAccess-Citizen",
  "MyPermit UC Enviro",
  "MyPermit UC Urbanisme",
  "NOVA_R",
  "NOVA_UC",
  "NWOW",
  "service mission (PCE) - Livré",
  "SharedHost",
  "SInCrHo_H",
  "Soft HR Framework",
  "Soft HR UC",
  "vDC",
  "vDC Add-on Consume",
  "vDC - annule 6000000649 du 25.09.2025",
  "vDC - annule 6000000651 du 25.09.2025",
  "vDC - annule 6000000653 du 25.09.2025",
  "VPN_Connect",
  "VPN unmanaged",
  "VPN xFA Set-up",
  "VPS",
  "Workplace Essential",
  "Workplace Extended",
  "Workplace O365/E3",
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripUcBase(d: string): string {
  const t = d.trim();
  if (/_uc$/i.test(t)) return t.slice(0, -3).trim();
  if (/ uc$/i.test(t)) return t.slice(0, -3).trim();
  return t;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return dp[n]!;
}

/** First letters of each word in `sf` (for acronym matches like NWOW). */
function sfInitials(sf: string): string {
  return norm(sf)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0] ?? "")
    .join("");
}

/** Score 0–100 between SAP designation text and a canonical SF `Product2.Name`. */
function scoreSapAgainstSf(sapRaw: string, sf: string): number {
  const a = norm(sapRaw);
  const b = norm(sf);
  if (a === b) return 100;

  const ca = a.replace(/[\s-]/g, "");
  const cb = b.replace(/[\s-]/g, "");
  if (ca === cb) return 99;
  if (cb.length >= 4 && ca.includes(cb)) return Math.min(97, 78 + Math.round(18 * (cb.length / Math.max(ca.length, 1))));
  if (ca.length >= 4 && cb.includes(ca)) return Math.min(97, 78 + Math.round(18 * (ca.length / Math.max(cb.length, 1))));

  const init = sfInitials(sf);
  if (init.length >= 3 && ca === init) return 88;

  const ta = new Set(a.split(/[^a-z0-9]+/).filter((t) => t.length > 1));
  const tb = new Set(b.split(/[^a-z0-9]+/).filter((t) => t.length > 1));
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter++;
  }
  const union = ta.size + tb.size - inter;
  let jacBoost = 0;
  for (const t of ta) {
    if (t.length >= 3 && b.includes(t)) jacBoost = Math.max(jacBoost, 0.25 + 0.2 * Math.min(1, t.length / 12));
  }
  const jac = union > 0 ? inter / union + jacBoost : jacBoost;
  const jScore = jac > 0 ? Math.round(42 + 48 * Math.min(1, jac * 1.15)) : 0;

  const maxL = Math.max(ca.length, cb.length, 1);
  const dist = levenshtein(ca.slice(0, 56), cb.slice(0, 56));
  const levRatio = 1 - dist / maxL;
  const levScore = Math.round(35 + 55 * Math.max(0, Math.min(1, levRatio)));

  return Math.max(jScore, levScore);
}

export type FuzzyConfidenceTier = "HIGH" | "MEDIUM" | "LOW" | "REVIEW";

export function confidenceTier(score: number): FuzzyConfidenceTier {
  if (score >= 85) return "HIGH";
  if (score >= 70) return "MEDIUM";
  if (score >= 50) return "LOW";
  return "REVIEW";
}

/** First significant word in normalized designation (e.g. `bos` for `BOS_Framework`). */
function dominantToken(sapRaw: string): string | null {
  const parts = norm(sapRaw).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  return parts[0] ?? null;
}

export function bestSfProductFuzzy(
  sapDesignation: string,
  catalog: readonly string[] = SF_PRODUCT_NAMES
): { name: string; score: number; tier: FuzzyConfidenceTier; runnerUp: { name: string; score: number } | null } {
  const token = dominantToken(sapDesignation);
  const pool =
    token && token.length >= 2
      ? catalog.filter((sf) => norm(sf).includes(token))
      : [...catalog];
  const searchSpace = pool.length > 0 ? pool : [...catalog];

  let best = { name: "", score: -1 };
  let second = { name: "", score: -1 };
  for (const sf of searchSpace) {
    const s = scoreSapAgainstSf(sapDesignation, sf);
    if (s > best.score) {
      second = { ...best };
      best = { name: sf, score: s };
    } else if (s > second.score && sf !== best.name) {
      second = { name: sf, score: s };
    }
  }
  const tier = confidenceTier(best.score);
  const runnerUp =
    second.score >= 0 && second.name && second.name !== best.name ? { name: second.name, score: second.score } : null;
  return { name: best.name, score: best.score, tier, runnerUp };
}

function readExistingMappingDesignations(csvPath: string): string[] {
  if (!fs.existsSync(csvPath)) return [];
  const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");
  return rows.map((r) => (r["sap_designation"] ?? "").trim()).filter(Boolean);
}

function loadProducts(): ProductRow[] {
  const csvPath = resolveDatasetCsvPath("PRODUCTS.csv");
  const raw = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<Record<string, string>>(raw, { header: true, skipEmptyLines: true });
  const rows = (parsed.data ?? []).filter((r) => r && typeof r === "object");
  return rows
    .map((r) => ({
      id: (r["id"] ?? "").trim(),
      name: (r["name"] ?? "").trim(),
    }))
    .filter((r) => r.id.startsWith("PRD-") && r.name.length > 0);
}

function entityNormName(name: string): string {
  return norm(name.replace(/^\(sn\)\s*/i, ""));
}

/** Fallback when no row in OVERRIDES: substring / equality on catalogue names. */
function proposeFromCatalog(designation: string, products: ProductRow[]): { id: string | null; notes: string } {
  const base = stripUcBase(designation);
  const n = norm(base);
  const compact = n.replace(/\s/g, "");

  let best: { id: string; score: number; name: string } | null = null;
  for (const p of products) {
    const en = entityNormName(p.name);
    if (!en) continue;
    if (n === en) {
      return { id: p.id, notes: `exact name match: ${p.name}` };
    }
    const ec = en.replace(/\s/g, "");
    if (ec.includes(compact) || compact.includes(ec)) {
      const score = Math.min(ec.length, compact.length);
      if (!best || score > best.score) best = { id: p.id, score, name: p.name };
    }
  }
  if (best) {
    return { id: best.id, notes: `fuzzy contains: ${best.name}` };
  }

  const tokens = n.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  for (const p of products) {
    const en = entityNormName(p.name);
    if (!en) continue;
    for (const t of tokens) {
      if (en.includes(t)) {
        return { id: p.id, notes: `token "${t}" in ${p.name}` };
      }
    }
  }

  return { id: null, notes: "NEEDS_REVIEW: no automatic match" };
}

async function distinctFromDb(): Promise<string[] | null> {
  const url = process.env["DATABASE_URL"];
  if (!url) return null;
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });
  try {
    const rows = await prisma.$queryRaw<Array<{ product_label: string | null }>>`
      SELECT DISTINCT product_label
      FROM revenue_entry
      WHERE import_warning IS NOT NULL
        AND (
          import_warning LIKE 'Designation not matched%'
          OR import_warning LIKE 'STEP 2:%'
        )
        AND product_label IS NOT NULL
        AND product_label NOT LIKE 'annule facture%'
      ORDER BY 1;
    `;
    return rows.map((r) => r.product_label!).filter(Boolean);
  } catch {
    return null;
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const products = loadProducts();
  const validIds = new Set(products.map((p) => p.id));

  const fromDb = await distinctFromDb();
  const fromExisting = readExistingMappingDesignations(OUT);
  const designationSet = new Set<string>();
  for (const d of FALLBACK_DESIGNATIONS) designationSet.add(d);
  if (fromDb) for (const d of fromDb) designationSet.add(d);
  for (const d of fromExisting) designationSet.add(d);
  const designations = [...designationSet].filter((d) => !/^annule facture/i.test(d));
  designations.sort((a, b) => a.localeCompare(b));

  type OutRow = {
    sap_designation: string;
    sf_product_name: string;
    allocation_entity_id: string;
    notes: string;
  };

  type ReportRow = {
    sap_designation: string;
    fuzzy_sf: string;
    fuzzy_score: number;
    fuzzy_tier: FuzzyConfidenceTier;
    runner_up: string;
    sf_final: string;
    allocation_entity_id: string;
    notes: string;
  };

  const out: OutRow[] = [];
  const reportRows: ReportRow[] = [];
  const skippedRedundant: { sap: string; sf: string }[] = [];

  const FUZZY_MIN = 50;
  const SF_BY_NORM = new Map(SF_PRODUCT_NAMES.map((n) => [norm(n), n]));

  for (const des of designations) {
    const fuzzy = bestSfProductFuzzy(des, SF_PRODUCT_NAMES);
    const o = OVERRIDES[des];

    // Skip rows where SAP designation already equals an SF product name (after normalization)
    // and there's no manual override forcing an entry. Step 1 of the resolver handles them
    // automatically via `counterpart_reference + sf_product_name = product_label`.
    if (!o) {
      const exactSf = SF_BY_NORM.get(norm(des));
      if (exactSf) {
        skippedRedundant.push({ sap: des, sf: exactSf });
        reportRows.push({
          sap_designation: des,
          fuzzy_sf: exactSf,
          fuzzy_score: 100,
          fuzzy_tier: "HIGH",
          runner_up: fuzzy.runnerUp ? `${fuzzy.runnerUp.name} (${fuzzy.runnerUp.score})` : "—",
          sf_final: "(skipped — same as SF, step-1 match)",
          allocation_entity_id: "—",
          notes: `Redundant: SAP designation == SF product "${exactSf}"; resolver step 1 handles it.`,
        });
        continue;
      }
    }

    let id: string | null = null;
    let notes = "";
    let sfName = "";
    if (o) {
      id = o.id;
      sfName = (o.sfProductName ?? "").trim();
      notes = o.notes ?? "override";
      const sfExplicitlyEmpty = o.sfProductName === "";
      if (!sfName && !sfExplicitlyEmpty && fuzzy.score >= FUZZY_MIN) {
        sfName = fuzzy.name;
        notes = `${notes} | SF from fuzzy ${fuzzy.tier} ${fuzzy.score}% → ${fuzzy.name}`;
      }
    } else {
      const proposed = proposeFromCatalog(des, products);
      id = proposed.id;
      notes = proposed.notes;
      if (fuzzy.score >= FUZZY_MIN) {
        sfName = fuzzy.name;
        notes = `${notes} | SF fuzzy ${fuzzy.tier} ${fuzzy.score}% → ${fuzzy.name}`;
      }
    }
    if (id && !validIds.has(id)) {
      notes = `${notes} | INVALID_ID_${id}`;
      id = null;
    }
    const row: OutRow = {
      sap_designation: des,
      sf_product_name: sfName,
      allocation_entity_id: id && validIds.has(id) ? id : "",
      notes,
    };
    out.push(row);

    reportRows.push({
      sap_designation: des,
      fuzzy_sf: fuzzy.name,
      fuzzy_score: fuzzy.score,
      fuzzy_tier: fuzzy.tier,
      runner_up: fuzzy.runnerUp ? `${fuzzy.runnerUp.name} (${fuzzy.runnerUp.score})` : "—",
      sf_final: sfName,
      allocation_entity_id: row.allocation_entity_id,
      notes: row.notes,
    });
  }

  out.sort((a, b) => a.sap_designation.localeCompare(b.sap_designation));
  reportRows.sort((a, b) => a.sap_designation.localeCompare(b.sap_designation));

  const csv = Papa.unparse(out, { columns: ["sap_designation", "sf_product_name", "allocation_entity_id", "notes"] });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `\uFEFF${csv}`, "utf8");

  const high = reportRows.filter((r) => r.fuzzy_tier === "HIGH").length;
  const med = reportRows.filter((r) => r.fuzzy_tier === "MEDIUM").length;
  const low = reportRows.filter((r) => r.fuzzy_tier === "LOW").length;
  const rev = reportRows.filter((r) => r.fuzzy_tier === "REVIEW").length;

  const md = [
    "# SAP designation → SF product name — fuzzy confidence report",
    "",
    "Generated by `scripts/build-sap-designation-mapping-csv.ts` alongside `SAP_DESIGNATION_MAPPING.csv`.",
    "",
    "## Summary",
    "",
    `| Tier | Count | Meaning |`,
    `|------|-------|---------|`,
    `| **HIGH** (≥85) | ${high} | Safe default for \`sf_product_name\` |`,
    `| **MEDIUM** (70–84) | ${med} | Likely correct — spot-check |`,
    `| **LOW** (50–69) | ${low} | Weak signal — verify before relying on AR link |`,
    `| **REVIEW** (<50) | ${rev} | No confident SF match from catalogue |`,
    "",
    `Catalog size: **${SF_PRODUCT_NAMES.length}** canonical SF \`Product2.Name\` values (\`scripts/data/sf-product-names.ts\`).`,
    `Rows in this run: **${reportRows.length}** SAP designations (**${out.length}** kept in CSV, **${skippedRedundant.length}** skipped as redundant — same as an SF product name, handled by resolver step 1).`,
    "",
    "## Per-row detail",
    "",
    "| SAP designation | Best SF (fuzzy) | Score | Tier | Runner-up | SF in CSV | PRD | Notes |",
    "|-----------------|-----------------|-------|------|-----------|-----------|-----|-------|",
    ...reportRows.map((r) => {
      const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
      return `| ${esc(r.sap_designation)} | ${esc(r.fuzzy_sf)} | ${r.fuzzy_score} | ${r.fuzzy_tier} | ${esc(r.runner_up)} | ${esc(r.sf_final || "—")} | ${esc(r.allocation_entity_id || "—")} | ${esc(r.notes)} |`;
    }),
    "",
  ].join("\n");
  fs.writeFileSync(FUZZY_REPORT, md, "utf8");

  const seeded = out.filter((r) => r.allocation_entity_id).length;
  const pending = out.length - seeded;
  console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${out.length} rows, ${seeded} with PRD id, ${pending} pending review; ${skippedRedundant.length} redundant rows skipped — exact SF match).`);
  console.log(`Wrote ${path.relative(process.cwd(), FUZZY_REPORT)} (fuzzy tiers: HIGH=${high} MEDIUM=${med} LOW=${low} REVIEW=${rev}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
