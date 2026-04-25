import { Version3Client } from "jira.js";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JiraFieldMeta = { id: string; name: string };

type JiraIssueFields = Record<string, unknown>;
type JiraIssueRow = { key: string; issueId: string | null; fields: JiraIssueFields };

type AllocationEntityTypeString = "PRODUCT" | "PROJECT" | "PROGRAM" | "INFRASTRUCTURE" | "TEAM";

function sameDateOrNull(a: Date | null, b: Date | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return a.getTime() === b.getTime();
}

function sameStringOrNull(a: string | null, b: string | null): boolean {
  const aa = a ?? null;
  const bb = b ?? null;
  return aa === bb;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
}

function jiraHost(): string {
  const raw = process.env.JIRA_HOST?.trim() || process.env.JIRA_BASE_URL?.trim();
  if (!raw) {
    throw new Error("Missing required environment variable: JIRA_HOST (or JIRA_BASE_URL)");
  }
  return raw.replace(/\/+$/, "");
}

function jiraToken(): string {
  const raw = process.env.JIRA_TOKEN?.trim() || process.env.JIRA_API_TOKEN?.trim();
  if (!raw) {
    throw new Error("Missing required environment variable: JIRA_TOKEN (or JIRA_API_TOKEN)");
  }
  return raw;
}

/**
 * Jira issue keys are case-insensitive; Prisma/Postgres PK matching is exact.
 * Normalize so pre-sync existence checks match CSV/seed rows (e.g. `RI-123`).
 */
function normalizeJiraIssueKey(key: string | undefined): string | null {
  if (key == null) return null;
  const t = String(key).trim();
  if (!t) return null;
  return t.toUpperCase();
}

function outwardLinkedProductKeys(fields: JiraIssueFields): string[] {
  const links = fields["issuelinks"];
  if (!Array.isArray(links) || links.length === 0) return [];

  const keys: string[] = [];
  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const outward = (link as { outwardIssue?: unknown }).outwardIssue;
    if (!outward || typeof outward !== "object") continue;

    const outwardKey =
      "key" in outward ? normalizeJiraIssueKey(String((outward as { key?: unknown }).key)) : null;
    if (!outwardKey) continue;

    const outwardFields =
      "fields" in outward && (outward as { fields?: unknown }).fields && typeof (outward as { fields?: unknown }).fields === "object"
        ? ((outward as { fields?: unknown }).fields as Record<string, unknown>)
        : null;
    const outwardIssueTypeName =
      outwardFields &&
      typeof outwardFields.issuetype === "object" &&
      outwardFields.issuetype !== null &&
      "name" in (outwardFields.issuetype as Record<string, unknown>)
        ? String((outwardFields.issuetype as { name?: unknown }).name)
        : null;

    if (outwardIssueTypeName !== "Product") continue;
    keys.push(outwardKey);
  }

  return Array.from(new Set(keys));
}

function firstComponentName(fields: JiraIssueFields): string | null {
  const c = fields.components;
  if (!Array.isArray(c) || c.length === 0) return null;
  const x = c[0];
  if (x && typeof x === "object" && x !== null && "name" in x) {
    const n = (x as { name: unknown }).name;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }
  return null;
}

/** All Jira component names in order (for Product lookup — first match wins). */
function componentNamesFromFields(fields: JiraIssueFields): string[] {
  const c = fields.components;
  if (!Array.isArray(c) || c.length === 0) return [];
  const names: string[] = [];
  for (const x of c) {
    if (x && typeof x === "object" && x !== null && "name" in x) {
      const n = (x as { name: unknown }).name;
      if (typeof n === "string" && n.trim()) names.push(n.trim());
    }
  }
  return names;
}

function statusName(fields: JiraIssueFields): string {
  const s = fields.status;
  if (s && typeof s === "object" && s !== null && "name" in s) {
    return String((s as { name: unknown }).name);
  }
  return "";
}

function issueTypeName(fields: JiraIssueFields): string | null {
  const it = fields.issuetype;
  if (it && typeof it === "object" && it !== null && "name" in it) {
    const n = (it as { name?: unknown }).name;
    const t = typeof n === "string" ? n.trim() : String(n ?? "").trim();
    return t ? t : null;
  }
  return null;
}

function extractAdfPlainText(node: unknown): string | null {
  const parts: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === "string") {
      parts.push(n);
      return;
    }
    if (Array.isArray(n)) {
      for (const x of n) walk(x);
      return;
    }
    if (typeof n === "object" && n !== null) {
      const o = n as Record<string, unknown>;
      if (typeof o.text === "string") parts.push(o.text);
      if (o.content != null) walk(o.content);
    }
  };
  if (node && typeof node === "object" && (node as { type?: unknown }).type === "doc") {
    walk((node as { content?: unknown }).content);
  } else {
    walk(node);
  }
  const t = parts.join(" ").replace(/\s+/g, " ").trim();
  return t.length ? t : null;
}

function formatJiraFieldValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "string") {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return null;
    const parts: string[] = [];
    for (const item of v) {
      const s = formatJiraFieldValue(item);
      if (s) parts.push(s);
    }
    return parts.length ? parts.join(", ") : null;
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if (o.type === "doc") {
      const adf = extractAdfPlainText(o);
      if (adf) return adf;
    }
    if (typeof o.displayName === "string" && o.displayName.trim()) return o.displayName.trim();
    if (o.name != null && String(o.name).trim()) return String(o.name).trim();
    if (o.value != null && typeof o.child === "object" && o.child !== null) {
      const child = o.child as Record<string, unknown>;
      const left = String(o.value).trim();
      const right =
        child.value != null
          ? String(child.value).trim()
          : child.name != null
            ? String(child.name).trim()
            : "";
      if (left && right) return `${left} / ${right}`;
      return left || right || null;
    }
    if (o.value != null) return String(o.value).trim();
  }
  return null;
}

function readScalarField(fields: JiraIssueFields, fieldId: string | undefined): string | null {
  if (!fieldId) return null;
  return formatJiraFieldValue(fields[fieldId]);
}

function normalizeFieldLabel(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findFieldIdByExactNames(fields: JiraFieldMeta[], candidates: string[]): string | undefined {
  const byNorm = new Map<string, string>();
  for (const f of fields) {
    byNorm.set(normalizeFieldLabel(f.name), f.id);
  }
  for (const c of candidates) {
    const id = byNorm.get(normalizeFieldLabel(c));
    if (id) return id;
  }
  return undefined;
}

function findFieldIdByRegex(fields: JiraFieldMeta[], re: RegExp): string | undefined {
  for (const f of fields) {
    if (re.test(f.name)) return f.id;
  }
  return undefined;
}

function tryResolveFieldFromNameOrId(
  fields: JiraFieldMeta[],
  raw: string | undefined,
  excludeIds: Set<string>
): string | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  if (/^customfield_\d+$/i.test(s)) {
    if (excludeIds.has(s)) return undefined;
    return s;
  }
  const id = findFieldIdByExactNames(fields, [s]);
  if (!id || excludeIds.has(id)) return undefined;
  return id;
}

function matchesInitiativeTypeFieldName(name: string): boolean {
  const n = name.normalize("NFKC");
  /** Jira label is often "(RI) Type" — no "initiative" in the name. */
  if (/\(\s*RI\s*\)\s*type\b/i.test(n)) return true;
  if (!/\binitiative\b/i.test(n)) return false;
  if (/\btype\b/i.test(n)) return true;
  if (/\b(category|categorie|catégorie|classification|class|typology|typologie)\b/i.test(n)) return true;
  if (/type\s*d['\u2019]\s*initiative/i.test(n)) return true;
  if (/initiative\s*[-–]\s*type/i.test(n)) return true;
  return false;
}

function findInitiativeTypeByHeuristic(fields: JiraFieldMeta[], excludeIds: Set<string>): string | undefined {
  for (const f of fields) {
    if (excludeIds.has(f.id)) continue;
    if (matchesInitiativeTypeFieldName(f.name)) return f.id;
  }
  return undefined;
}

function resolveYearFieldId(
  catalog: JiraFieldMeta[],
  explicit: string | undefined,
  excludeIds: Set<string>
): string | undefined {
  const pick = (id: string | undefined) => (id && !excludeIds.has(id) ? id : undefined);
  const fromEnv = tryResolveFieldFromNameOrId(catalog, explicit, excludeIds);
  if (fromEnv) return fromEnv;
  return (
    pick(findFieldIdByExactNames(catalog, ["Year", "Année", "Fiscal year", "Fiscal Year", "Planning year"])) ??
    pick(findFieldIdByRegex(catalog, /\bplanning\s*year\b/i)) ??
    pick(findFieldIdByRegex(catalog, /\bfiscal\s*year\b/i)) ??
    pick(findFieldIdByRegex(catalog, /\byear\b/i))
  );
}

function resolveInitiativeTypeFieldId(
  fields: JiraFieldMeta[],
  explicit: string | undefined,
  nameOverride: string | undefined,
  excludeIds: Set<string>
): string | undefined {
  const pick = (id: string | undefined) => (id && !excludeIds.has(id) ? id : undefined);

  if (explicit?.trim()) return pick(explicit.trim());
  const fromOverride = tryResolveFieldFromNameOrId(fields, nameOverride, excludeIds);
  if (fromOverride) return fromOverride;

  const exact = pick(
    findFieldIdByExactNames(fields, [
      "Initiative Type",
      "Initiative type",
      "Type d'initiative",
      "Type d’initiative",
      "RI Initiative Type",
      "Type (RI)",
      "(RI) Type",
      "(RI) type",
    ])
  );
  if (exact) return exact;

  const riType = pick(findFieldIdByRegex(fields, /\(\s*RI\s*\)\s*type\b/i));
  if (riType) return riType;

  const regexList: RegExp[] = [
    /\binitiative\s*type\b/i,
    /type\s*d['\u2019]\s*initiative/i,
    /ri\s*[-–]?\s*initiative\s*type/i,
  ];
  for (const re of regexList) {
    const id = findFieldIdByRegex(fields, re);
    if (pick(id)) return id;
  }

  return findInitiativeTypeByHeuristic(fields, excludeIds);
}

function parseYear(raw: string | null, fallbackDate: Date): number {
  if (raw == null || raw === "") {
    return fallbackDate.getFullYear();
  }
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n)) return n;
  return fallbackDate.getFullYear();
}

function parseDate(iso: unknown): Date {
  if (typeof iso !== "string") return new Date();
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

function parseNullableFloat(raw: string | null): number | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function splitSapProgFin(raw: string | null): { code: string | null; name: string | null } {
  if (raw == null) return { code: null, name: null };
  const t = raw.trim();
  if (!t) return { code: null, name: null };
  const parts = t.split(" - ");
  if (parts.length === 1) return { code: t, name: null };
  const code = parts[0]?.trim() || null;
  const name = parts.slice(1).join(" - ").trim() || null;
  return { code, name };
}

function allocationEntityTypeFromJira(raw: string | null): AllocationEntityTypeString | null {
  if (raw == null) return null;
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  const map: Record<string, AllocationEntityTypeString> = {
    PRODUCT: "PRODUCT",
    PROJECT: "PROJECT",
    PROGRAM: "PROGRAM",
    INFRASTRUCTURE: "INFRASTRUCTURE",
    TEAM: "TEAM",
  };
  return map[t] ?? null;
}

function normalizeJqlTypography(jql: string): string {
  return jql
    .replace(/[\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/\u00A0/g, " ")
    .trim();
}

function extractSavedFilterId(raw: string): string {
  const normalized = normalizeJqlTypography(raw);
  const explicit = normalized.match(/filter\s*=\s*(\d+)/i);
  if (explicit) return explicit[1];
  const leading = normalized.match(/^(\d+)/);
  if (leading) return leading[1];
  const digits = normalized.replace(/\D/g, "");
  if (digits.length > 0) return digits;
  throw new Error(
    "JIRA_FILTER_ID must be a numeric saved filter id (e.g. 12345). Remove em dashes or use JIRA_JQL for raw JQL."
  );
}

function toFieldCatalog(rows: unknown): JiraFieldMeta[] {
  if (!Array.isArray(rows)) return [];
  const out: JiraFieldMeta[] = [];
  for (const row of rows) {
    if (row && typeof row === "object" && "id" in row && "name" in row) {
      const id = String((row as { id: unknown }).id);
      const name = String((row as { name: unknown }).name);
      if (id && name) out.push({ id, name });
    }
  }
  return out;
}

function resolveProductFieldIds(
  fields: JiraFieldMeta[],
  env: {
    productFamily?: string;
    division?: string;
    subDivision?: string;
    team?: string;
    sapProgFin?: string;
    attractiveness?: string;
    competitiveness?: string;
    typeProduct?: string;
  }
): {
  productFamily?: string;
  division?: string;
  subDivision?: string;
  team?: string;
  sapProgFin?: string;
  attractiveness?: string;
  competitiveness?: string;
  typeProduct?: string;
} {
  const exclude = new Set<string>();
  const resolve = (explicit: string | undefined, candidates: string[], regex?: RegExp) => {
    const fromEnv = tryResolveFieldFromNameOrId(fields, explicit, exclude);
    if (fromEnv) return fromEnv;
    const id =
      findFieldIdByExactNames(fields, candidates) ??
      (regex ? findFieldIdByRegex(fields, regex) : undefined);
    if (id) exclude.add(id);
    return id;
  };

  const productFamily = resolve(env.productFamily, ["(RI) ProductFamily", "(RI) Product Family", "ProductFamily"]);
  const division = resolve(env.division, ["(RI) DIVISION", "(RI) Division", "Division"]);
  const subDivision = resolve(env.subDivision, ["(RI) SubDivision", "(RI) Sub Division", "SubDivision", "Sub-division"]);
  const team = resolve(env.team, ["(RI) TEAM", "(RI) Team", "Team"]);
  const sapProgFin = resolve(
    env.sapProgFin,
    [
      "(RI) SAP PROG. FIN.",
      "(RI) SAP PROG FIN",
      "(RI) SAP PROG. FIN",
      "(RI) SAP PROGR. FIN.",
      "(RI) SAP PROGR FIN",
      "(RI) SAP PROGRAM FIN",
      "SAP PROG. FIN.",
    ],
    /\bsap\b.*\bprog(r|ram)?\b.*\bfin\b/i
  );
  const attractiveness = resolve(env.attractiveness, ["(RI) Attractiveness", "Attractiveness"]);
  const competitiveness = resolve(env.competitiveness, ["(RI) Competitiveness", "Competitiveness"]);
  const typeProduct = resolve(env.typeProduct, ["(RI) Type Product", "(RI) Type product", "Type Product"], /\btype\b.*\bproduct\b/i);

  return {
    productFamily,
    division,
    subDivision,
    team,
    sapProgFin,
    attractiveness,
    competitiveness,
    typeProduct,
  };
}

async function searchAllIssues(params: {
  client: Version3Client;
  jql: string;
  fields: string[];
  maxResults?: number;
}): Promise<JiraIssueRow[]> {
  const { client, jql, fields } = params;
  const maxResults = params.maxResults ?? 100;

  const issues: JiraIssueRow[] = [];
  let nextPageToken: string | undefined;

  while (true) {
    const parsed = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
      jql,
      maxResults,
      fields,
      nextPageToken,
    });

    const batch = parsed.issues ?? [];
    for (const issue of batch) {
      const key = normalizeJiraIssueKey(issue.key);
      if (!key || !issue.fields) continue;
      const issueId = typeof issue.id === "string" && issue.id.trim() ? issue.id.trim() : null;
      issues.push({ key, issueId, fields: issue.fields as JiraIssueFields });
    }

    if (batch.length === 0) break;
    const resp = parsed as { isLast?: boolean; nextPageToken?: string };
    if (resp.isLast === true) break;
    const tokenNext =
      typeof resp.nextPageToken === "string" && resp.nextPageToken.length > 0
        ? resp.nextPageToken
        : undefined;
    if (tokenNext) {
      nextPageToken = tokenNext;
      continue;
    }
    if (batch.length < maxResults) break;
    throw new Error("Jira returned a full page of issues but no nextPageToken; cannot load more pages.");
  }

  return issues;
}

export async function GET(request: Request) {
  const debug = (() => {
    try {
      return new URL(request.url).searchParams.get("debug") === "1";
    } catch {
      return false;
    }
  })();

  let host: string;
  let email: string;
  let token: string;
  let jql: string;

  try {
    host = jiraHost();
    email = requireEnv("JIRA_EMAIL");
    token = jiraToken();

    const jiraJql = process.env.JIRA_JQL?.trim();
    if (jiraJql) {
      jql = normalizeJqlTypography(jiraJql);
    } else {
      const filterRaw = requireEnv("JIRA_FILTER_ID");
      jql = `filter = ${extractSavedFilterId(filterRaw)}`;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Configuration error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }

  const fieldYearEnv = process.env.JIRA_FIELD_YEAR?.trim();
  const fieldInitiativeTypeEnv = process.env.JIRA_FIELD_INITIATIVE_TYPE?.trim();
  const fieldInitiativeTypeNameEnv = process.env.JIRA_FIELD_INITIATIVE_TYPE_NAME?.trim();

  const client = new Version3Client({
    host,
    authentication: {
      basic: {
        email,
        apiToken: token,
      },
    },
  });

  let jiraFieldCatalog: JiraFieldMeta[] = [];
  try {
    const rows = await client.issueFields.getFields();
    jiraFieldCatalog = toFieldCatalog(rows as unknown);
  } catch {
    jiraFieldCatalog = [];
  }

  const debugFieldHints = debug
    ? {
        sapLike: jiraFieldCatalog
          .filter((f) => /\bsap\b/i.test(f.name) || /\bprog\b/i.test(f.name) || /\bfin\b/i.test(f.name))
          .slice(0, 20),
      }
    : null;

  const resolvedYearFieldId = resolveYearFieldId(jiraFieldCatalog, fieldYearEnv, new Set());
  const resolvedInitiativeTypeFieldId = resolveInitiativeTypeFieldId(
    jiraFieldCatalog,
    fieldInitiativeTypeEnv,
    fieldInitiativeTypeNameEnv,
    new Set([resolvedYearFieldId].filter((x): x is string => Boolean(x)))
  );

  const productFieldIds = resolveProductFieldIds(jiraFieldCatalog, {
    productFamily: process.env.JIRA_FIELD_PRODUCT_FAMILY?.trim(),
    division: process.env.JIRA_FIELD_DIVISION?.trim(),
    subDivision: process.env.JIRA_FIELD_SUB_DIVISION?.trim(),
    team: process.env.JIRA_FIELD_TEAM?.trim(),
    sapProgFin: process.env.JIRA_FIELD_SAP_PROG_FIN?.trim(),
    attractiveness: process.env.JIRA_FIELD_ATTRACTIVENESS?.trim(),
    competitiveness: process.env.JIRA_FIELD_COMPETITIVENESS?.trim(),
    typeProduct: process.env.JIRA_FIELD_TYPE_PRODUCT?.trim(),
  });

  const jiraFields = Array.from(
    new Set([
      "summary",
      "status",
      "issuetype",
      "components",
      "issuelinks",
      "created",
      "updated",
      ...(resolvedYearFieldId ? [resolvedYearFieldId] : []),
      ...(resolvedInitiativeTypeFieldId ? [resolvedInitiativeTypeFieldId] : []),
    ])
  );

  const now = new Date();
  const debugProducts: Array<Record<string, unknown>> = [];
  const debugProductFieldIds = debug ? productFieldIds : null;

  // 1) Sync Products → AllocationEntity (match by jiraIssueId → jiraKey → name; create id=jiraKey when missing)
  const productJql = normalizeJqlTypography(process.env.JIRA_PRODUCT_JQL?.trim() || "issuetype = Product");
  const productFields = Array.from(
    new Set([
      "summary",
      "status",
      "updated",
      "issuetype",
      "components",
      ...Object.values(productFieldIds).filter((x): x is string => Boolean(x)),
    ])
  );

  let productsFetched = 0;
  let productsCreated = 0;
  let productsUpdated = 0;
  let productsIdCollision = 0;

  try {
    const productIssues = await searchAllIssues({ client, jql: productJql, fields: productFields, maxResults: 100 });
    productsFetched = productIssues.length;

    for (const issue of productIssues) {
      const summary = typeof issue.fields.summary === "string" ? issue.fields.summary.trim() : "";
      if (!summary) continue;
      const jiraUpdatedAt = parseDate(issue.fields.updated);
      const nextJiraKey = issue.key;
      const nextIssueId = issue.issueId;
      const nextStatus = statusName(issue.fields) || null;

      const nextProductFamily = readScalarField(issue.fields, productFieldIds.productFamily) ?? null;
      const nextDivision = readScalarField(issue.fields, productFieldIds.division) ?? null;
      const nextSubDivision = readScalarField(issue.fields, productFieldIds.subDivision) ?? null;
      const nextTeam = readScalarField(issue.fields, productFieldIds.team) ?? null;
      const sapProgFinRaw = readScalarField(issue.fields, productFieldIds.sapProgFin) ?? null;
      const nextSap = splitSapProgFin(sapProgFinRaw);
      const nextAttractiveness = parseNullableFloat(
        readScalarField(issue.fields, productFieldIds.attractiveness)
      );
      const nextCompetitiveness = parseNullableFloat(
        readScalarField(issue.fields, productFieldIds.competitiveness)
      );
      const nextTypeProduct = allocationEntityTypeFromJira(
        readScalarField(issue.fields, productFieldIds.typeProduct)
      );

      const byIssueId = nextIssueId
        ? await prisma.allocationEntity.findFirst({
            where: { jiraIssueId: nextIssueId },
            select: {
              id: true,
              name: true,
              jiraKey: true,
              jiraIssueId: true,
              jiraStatus: true,
              jiraUpdatedAt: true,
              productFamily: true,
              division: true,
              subDivision: true,
              team: true,
              sapEotpCode: true,
              sapEotpName: true,
              attractiveness: true,
              competitiveness: true,
              type: true,
            },
          })
        : null;

      const byJiraKey =
        byIssueId == null && nextJiraKey
          ? await prisma.allocationEntity.findFirst({
              where: { jiraKey: nextJiraKey },
              select: {
                id: true,
                name: true,
                jiraKey: true,
                jiraIssueId: true,
                jiraStatus: true,
                jiraUpdatedAt: true,
                productFamily: true,
                division: true,
                subDivision: true,
                team: true,
                sapEotpCode: true,
                sapEotpName: true,
                attractiveness: true,
                competitiveness: true,
                type: true,
              },
            })
          : null;

      const byName =
        byIssueId == null && byJiraKey == null
          ? await prisma.allocationEntity.findUnique({
              where: { name: summary },
              select: {
                id: true,
                name: true,
                jiraKey: true,
                jiraIssueId: true,
                jiraStatus: true,
                jiraUpdatedAt: true,
                productFamily: true,
                division: true,
                subDivision: true,
                team: true,
                sapEotpCode: true,
                sapEotpName: true,
                attractiveness: true,
                competitiveness: true,
                type: true,
              },
            })
          : null;

      const existing = byIssueId ?? byJiraKey ?? byName;
      const matchSource = byIssueId ? "jiraIssueId" : byJiraKey ? "jiraKey" : byName ? "name" : null;

      if (existing) {
        const nameTakenByOther =
          existing.name !== summary
            ? (await prisma.allocationEntity.findUnique({
                where: { name: summary },
                select: { id: true },
              })) != null
            : false;

        const nextName = nameTakenByOther ? existing.name : summary;

        if (nameTakenByOther && existing.name !== summary) {
          console.warn(
            {
              jiraKey: nextJiraKey,
              jiraIssueId: nextIssueId,
              fromName: existing.name,
              toName: summary,
            },
            "Cannot rename AllocationEntity to new Jira Product summary because name is already taken"
          );
        }

        const changed =
          existing.name !== nextName ||
          !sameStringOrNull(existing.jiraKey, nextJiraKey) ||
          !sameStringOrNull(existing.jiraIssueId, nextIssueId) ||
          !sameStringOrNull(existing.jiraStatus, nextStatus) ||
          !sameDateOrNull(existing.jiraUpdatedAt, jiraUpdatedAt) ||
          (existing.productFamily ?? null) !== nextProductFamily ||
          (existing.division ?? null) !== nextDivision ||
          (existing.subDivision ?? null) !== nextSubDivision ||
          (existing.team ?? null) !== nextTeam ||
          (existing.sapEotpCode ?? null) !== (nextSap.code ?? null) ||
          (existing.sapEotpName ?? null) !== (nextSap.name ?? null) ||
          (existing.attractiveness ?? null) !== (nextAttractiveness ?? null) ||
          (existing.competitiveness ?? null) !== (nextCompetitiveness ?? null) ||
          (nextTypeProduct != null && String(existing.type) !== nextTypeProduct);

        if (changed) {
          await prisma.allocationEntity.update({
            where: { id: existing.id },
            data: {
              name: nextName,
              jiraKey: nextJiraKey,
              jiraIssueId: nextIssueId,
              jiraStatus: nextStatus,
              jiraUpdatedAt,
              jiraLastSyncedAt: now,
              productFamily: nextProductFamily,
              division: nextDivision,
              subDivision: nextSubDivision,
              team: nextTeam,
              sapEotpCode: nextSap.code,
              sapEotpName: nextSap.name,
              attractiveness: nextAttractiveness,
              competitiveness: nextCompetitiveness,
              ...(nextTypeProduct ? { type: nextTypeProduct } : {}),
            },
          });
          productsUpdated++;
        }
        if (debug && debugProducts.length < 50) {
          debugProducts.push({
            jiraKey: nextJiraKey,
            jiraIssueId: nextIssueId,
            summary,
            jiraUpdatedAt: jiraUpdatedAt.toISOString(),
            matchSource,
            entityId: existing.id,
            entityNameBefore: existing.name,
            entityNameAfter: nextName,
            mapped: {
              type: nextTypeProduct,
              productFamily: nextProductFamily,
              division: nextDivision,
              subDivision: nextSubDivision,
              team: nextTeam,
              sapEotpCode: nextSap.code,
              sapEotpName: nextSap.name,
              attractiveness: nextAttractiveness,
              competitiveness: nextCompetitiveness,
            },
            changed,
          });
        }
        continue;
      }

      const idPreferred = issue.key;
      const idCollision = await prisma.allocationEntity.findUnique({
        where: { id: idPreferred },
        select: { id: true },
      });

      const id = idCollision ? `PRD-JIRA-${issue.key}` : idPreferred;
      if (idCollision) productsIdCollision++;

      await prisma.allocationEntity.create({
        data: {
          id,
          name: summary,
          type: nextTypeProduct ?? "PRODUCT",
          source: "jira",
          jiraKey: issue.key,
          jiraIssueId: issue.issueId,
          jiraStatus: statusName(issue.fields) || null,
          jiraUpdatedAt,
          jiraLastSyncedAt: now,
          productFamily: nextProductFamily,
          division: nextDivision,
          subDivision: nextSubDivision,
          team: nextTeam,
          sapEotpCode: nextSap.code,
          sapEotpName: nextSap.name,
          attractiveness: nextAttractiveness,
          competitiveness: nextCompetitiveness,
        },
      });
      productsCreated++;
      if (debug && debugProducts.length < 50) {
        debugProducts.push({
          jiraKey: nextJiraKey,
          jiraIssueId: nextIssueId,
          summary,
          jiraUpdatedAt: jiraUpdatedAt.toISOString(),
          matchSource,
          created: true,
          entityId: id,
        });
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Jira product sync failed";
    return Response.json({ ok: false, error: message, step: "syncProducts" }, { status: 502 });
  }

  // Rebuild component → allocation entity map after product sync (names may have changed).
  const allocationEntityMap = new Map<string, string>();
  const allEntitiesAfterProducts = await prisma.allocationEntity.findMany({ select: { id: true, name: true } });
  for (const p of allEntitiesAfterProducts) {
    allocationEntityMap.set(p.name.trim().toLowerCase(), p.id);
  }

  // 2) Sync Initiatives and map AllocationEntity
  let initiativesFetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let skippedNonInitiativeIssueType = 0;

  let mappedByOutwardLink = 0;
  let mappedByComponentFallback = 0;
  let unmapped = 0;
  let ambiguousMultipleOutwardLinks = 0;
  let outwardLinkProductNotFound = 0;

  let initiativeIssues: JiraIssueRow[] = [];
  try {
    initiativeIssues = await searchAllIssues({ client, jql, fields: jiraFields, maxResults: 100 });
    initiativesFetched = initiativeIssues.length;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Jira initiative sync failed";
    return Response.json({ ok: false, error: message, step: "syncInitiatives" }, { status: 502 });
  }

  for (const issue of initiativeIssues) {
    const id = issue.key;
    const f = issue.fields;
    if (!id) {
      skipped++;
      continue;
    }

    // Guard: the Jira filter/JQL can include non-Initiative items; do not upsert them into `Initiative`.
    const itName = issueTypeName(f);
    if (itName !== "Initiative") {
      skippedNonInitiativeIssueType++;
      if (debug && skippedNonInitiativeIssueType <= 20) {
        console.warn(
          { key: id, issuetype: itName ?? null },
          "Skipping non-Initiative issue returned by Jira JQL/filter"
        );
      }
      continue;
    }

    const summary = typeof f.summary === "string" ? f.summary : "";
    const modifiedOn = parseDate(f.updated ?? f.created);
    const createdOn = parseDate(f.created);
    const jiraUpdatedAt = parseDate(f.updated);

    const yearRaw = readScalarField(f, resolvedYearFieldId);
    const year = parseYear(yearRaw, modifiedOn);

    const jiraInitiativeType = readScalarField(f, resolvedInitiativeTypeFieldId);
    const componentsStr = firstComponentName(f);

    const productKeys = outwardLinkedProductKeys(f);

    let allocationEntityId: string | null = null;
    let linkedProductKey: string | null = null;
    let mappingSource: string | null = null;

    if (productKeys.length === 1) {
      linkedProductKey = productKeys[0];
      const found = await prisma.allocationEntity.findFirst({
        where: {
          OR: [{ jiraKey: linkedProductKey }, { id: linkedProductKey }],
        },
        select: { id: true },
      });
      if (found) {
        allocationEntityId = found.id;
        mappingSource = "jira_outward_product_link";
        mappedByOutwardLink++;
      } else {
        mappingSource = "jira_outward_product_link_no_match";
        outwardLinkProductNotFound++;
        console.warn(
          { initiativeKey: id, linkedProductKey },
          "Initiative has outward Product link but AllocationEntity not found"
        );
      }
    } else if (productKeys.length > 1) {
      mappingSource = "ambiguous_jira_outward_product_link";
      ambiguousMultipleOutwardLinks++;
      console.warn(
        { initiativeKey: id, productKeys },
        "Initiative has multiple outward Product links; not choosing one"
      );
    } else {
      const firstComp = firstComponentName(f);
      if (firstComp) {
        const foundId = allocationEntityMap.get(firstComp.toLowerCase()) ?? null;
        allocationEntityId = foundId;
        mappingSource = foundId ? "jira_component_name_fallback" : "jira_component_name_fallback_no_match";
        if (foundId) mappedByComponentFallback++;
        else unmapped++;
      } else {
        mappingSource = "no_product_link_no_component";
        unmapped++;
      }
    }

    /** Check immediately before upsert so counts match DB (avoids `in`-list / key mismatch issues). */
    const existedBefore =
      (await prisma.initiative.findUnique({ where: { id }, select: { id: true } })) != null;

    const jiraTypeTrimmed = jiraInitiativeType?.trim() ? jiraInitiativeType.trim() : null;

    const nextStatus = statusName(f);
    const nextInitiativeType = resolvedInitiativeTypeFieldId ? jiraTypeTrimmed : null;

    if (!existedBefore) {
      await prisma.initiative.create({
        data: {
          id,
          powerId: null,
          summary,
          status: nextStatus,
          year,
          components: componentsStr,
          productGroup: null,
          initiativeType: nextInitiativeType,
          allocationEntityId,
          jiraIssueId: issue.issueId,
          jiraUpdatedAt,
          jiraLastSyncedAt: now,
          linkedProductKey,
          componentNameFallback: componentsStr,
          allocationMappingSource: mappingSource,
          createdOn,
          modifiedOn,
        },
      });
      created++;
      continue;
    }

    const existing = await prisma.initiative.findUnique({
      where: { id },
      select: {
        summary: true,
        status: true,
        year: true,
        components: true,
        initiativeType: true,
        allocationEntityId: true,
        jiraIssueId: true,
        jiraUpdatedAt: true,
        linkedProductKey: true,
        componentNameFallback: true,
        allocationMappingSource: true,
      },
    });

    if (!existing) {
      // Extremely rare (race), but keep behaviour explicit.
      await prisma.initiative.create({
        data: {
          id,
          powerId: null,
          summary,
          status: nextStatus,
          year,
          components: componentsStr,
          productGroup: null,
          initiativeType: nextInitiativeType,
          allocationEntityId,
          jiraIssueId: issue.issueId,
          jiraUpdatedAt,
          jiraLastSyncedAt: now,
          linkedProductKey,
          componentNameFallback: componentsStr,
          allocationMappingSource: mappingSource,
          createdOn,
          modifiedOn,
        },
      });
      created++;
      continue;
    }

    const changed =
      existing.summary !== summary ||
      existing.status !== nextStatus ||
      existing.year !== year ||
      (existing.components ?? null) !== (componentsStr ?? null) ||
      (existing.initiativeType ?? null) !== (nextInitiativeType ?? null) ||
      (existing.allocationEntityId ?? null) !== (allocationEntityId ?? null) ||
      (existing.jiraIssueId ?? null) !== (issue.issueId ?? null) ||
      !sameDateOrNull(existing.jiraUpdatedAt, jiraUpdatedAt) ||
      (existing.linkedProductKey ?? null) !== (linkedProductKey ?? null) ||
      (existing.componentNameFallback ?? null) !== (componentsStr ?? null) ||
      (existing.allocationMappingSource ?? null) !== (mappingSource ?? null);

    if (changed) {
      await prisma.initiative.update({
        where: { id },
        data: {
          summary,
          status: nextStatus,
          year,
          components: componentsStr,
          allocationEntityId,
          jiraIssueId: issue.issueId,
          jiraUpdatedAt,
          jiraLastSyncedAt: now,
          linkedProductKey,
          componentNameFallback: componentsStr,
          allocationMappingSource: mappingSource,
          ...(resolvedInitiativeTypeFieldId ? { initiativeType: nextInitiativeType } : {}),
          modifiedOn,
        },
      });
      updated++;
    }
  }

  return Response.json({
    ok: true,
    products: {
      jql: productJql,
      fetched: productsFetched,
      created: productsCreated,
      updated: productsUpdated,
      idCollisions: productsIdCollision,
      fieldsRequested: productFields,
    },
    ...(debug
      ? { debug: { productFieldIds: debugProductFieldIds, fieldHints: debugFieldHints, products: debugProducts } }
      : {}),
    jql,
    fetched: initiativesFetched,
    created,
    updated,
    skipped,
    mapping: {
      mappedByOutwardLink,
      mappedByComponentFallback,
      unmapped,
      ambiguousMultipleOutwardLinks,
      outwardLinkProductNotFound,
    },
    skippedNonInitiativeIssueType,
    finishedAt: now.toISOString(),
    fieldsRequested: jiraFields,
    fieldMapping: {
      JIRA_FIELD_YEAR: fieldYearEnv ?? null,
      JIRA_FIELD_INITIATIVE_TYPE: fieldInitiativeTypeEnv ?? null,
      JIRA_FIELD_INITIATIVE_TYPE_NAME: fieldInitiativeTypeNameEnv ?? null,
      resolvedYearFieldId: resolvedYearFieldId ?? null,
      resolvedYearFieldName:
        resolvedYearFieldId != null
          ? (jiraFieldCatalog.find((x) => x.id === resolvedYearFieldId)?.name ?? null)
          : null,
      resolvedInitiativeTypeFieldId: resolvedInitiativeTypeFieldId ?? null,
      resolvedInitiativeTypeFieldName:
        resolvedInitiativeTypeFieldId != null
          ? (jiraFieldCatalog.find((x) => x.id === resolvedInitiativeTypeFieldId)?.name ?? null)
          : null,
    },
  });
}
