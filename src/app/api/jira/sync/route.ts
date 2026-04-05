import { Version3Client } from "jira.js";

import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type JiraFieldMeta = { id: string; name: string };

type JiraIssueFields = Record<string, unknown>;

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

function statusName(fields: JiraIssueFields): string {
  const s = fields.status;
  if (s && typeof s === "object" && s !== null && "name" in s) {
    return String((s as { name: unknown }).name);
  }
  return "";
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

export async function GET() {
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

  const resolvedYearFieldId = resolveYearFieldId(jiraFieldCatalog, fieldYearEnv, new Set());
  const resolvedInitiativeTypeFieldId = resolveInitiativeTypeFieldId(
    jiraFieldCatalog,
    fieldInitiativeTypeEnv,
    fieldInitiativeTypeNameEnv,
    new Set([resolvedYearFieldId].filter((x): x is string => Boolean(x)))
  );

  const jiraFields = Array.from(
    new Set([
      "summary",
      "status",
      "components",
      "created",
      "updated",
      ...(resolvedYearFieldId ? [resolvedYearFieldId] : []),
      ...(resolvedInitiativeTypeFieldId ? [resolvedInitiativeTypeFieldId] : []),
    ])
  );

  const maxResults = 100;
  const issues: { key: string; fields: JiraIssueFields }[] = [];

  try {
    let nextPageToken: string | undefined;

    while (true) {
      const parsed = await client.issueSearch.searchForIssuesUsingJqlEnhancedSearchPost({
        jql,
        maxResults,
        fields: jiraFields,
        nextPageToken,
      });

      const batch = parsed.issues ?? [];
      for (const issue of batch) {
        const key = normalizeJiraIssueKey(issue.key);
        if (key && issue.fields) {
          issues.push({ key, fields: issue.fields as JiraIssueFields });
        }
      }

      if (batch.length === 0) break;

      const resp = parsed as {
        isLast?: boolean;
        nextPageToken?: string;
      };
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

      return Response.json(
        {
          ok: false,
          error:
            "Jira returned a full page of issues but no nextPageToken; cannot load more pages.",
        },
        { status: 502 }
      );
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Jira request failed";
    return Response.json({ ok: false, error: message }, { status: 502 });
  }

  const now = new Date();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const issue of issues) {
    const id = issue.key;
    const f = issue.fields;
    if (!id) {
      skipped++;
      continue;
    }

    const summary = typeof f.summary === "string" ? f.summary : "";
    const modifiedOn = parseDate(f.updated ?? f.created);
    const createdOn = parseDate(f.created);

    const yearRaw = readScalarField(f, resolvedYearFieldId);
    const year = parseYear(yearRaw, modifiedOn);

    const jiraInitiativeType = readScalarField(f, resolvedInitiativeTypeFieldId);
    const componentsStr = firstComponentName(f);

    /** Check immediately before upsert so counts match DB (avoids `in`-list / key mismatch issues). */
    const existedBefore =
      (await prisma.initiative.findUnique({ where: { id }, select: { id: true } })) != null;

    const jiraTypeTrimmed = jiraInitiativeType?.trim() ? jiraInitiativeType.trim() : null;

    await prisma.initiative.upsert({
      where: { id },
      create: {
        id,
        powerId: null,
        summary,
        status: statusName(f),
        year,
        components: componentsStr,
        productGroup: null,
        initiativeType: resolvedInitiativeTypeFieldId ? jiraTypeTrimmed : null,
        createdOn,
        modifiedOn,
      },
      update: {
        summary,
        status: statusName(f),
        year,
        components: componentsStr,
        ...(resolvedInitiativeTypeFieldId ? { initiativeType: jiraTypeTrimmed } : {}),
        modifiedOn,
      },
    });

    if (existedBefore) updated++;
    else created++;
  }

  return Response.json({
    ok: true,
    jql,
    fetched: issues.length,
    created,
    updated,
    skipped,
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
