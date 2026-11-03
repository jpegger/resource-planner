/** Pure helpers for Service Pulse Excel export (Jira → Template_Board_Data). */

export const BUDGET_SERVICE_COLUMNS = [
  "Baseline_2026",
  "Sum_RUN",
  "Sum_BUILD",
  "Sum_Build_personnel",
  "Sum_Build_Cashout",
  "Sum_Couts_Build_Survie",
  "Sum_Couts_Build_Clients",
  "Sum_Cout_Build_Paradigm",
] as const;

export const REPORTING_ANNUEL_TAG = "Reporting Annuel";

/** Tag values that qualify an Initiative for the Service Pulse export. */
export const INITIATIVE_FILTER_TAGS = ["Reporting Annuel", "IA", "NIS", "NIS2"] as const;

/** Prefer these as the Excel Tags cell when several filter tags are present. */
const EXCEL_TAG_PRIORITY = ["NIS2", "NIS", "IA"] as const;

export type ServicePulseRow = {
  ID_Service: string;
  Jira_Key: string;
  Business_Line: string | null;
  Owner: string | null;
  Statut_Service: string | null;
  Vision_Produit: string | null;
  Segment_Client_1: string | null;
  Segment_Client_2: string | null;
  Segment_Client_3: string | null;
  Axes_LO_1: string | null;
  Axes_LO_2: string | null;
  Axes_LO_3: string | null;
  Nb_Clients_Actifs: number | null;
  KPI_Spe_Libelle: string | null;
  KPI_Spe_Data_YTD: number | null;
  "KPI_Spe_Data_Y-1": null;
  Usage_Evolution_Pct: string | null;
};

export type InitiativePulseRow = {
  ID_Service: string;
  Libelle_Initiative: string;
  Categorie: string | null;
  Annee: number | null;
  Quarter_Debut: string | null;
  Quarter_Fin: string | null;
  Statut: string;
  Tags: string | null;
  Description: string | null;
};

export function stripJiraKeyFromSummary(summary: string, issueKey?: string): string {
  const s = summary.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (issueKey?.trim()) {
    const key = issueKey.trim();
    const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-–—:]?\\s*`, "i");
    const stripped = s.replace(re, "").trim();
    if (stripped) return stripped;
  }
  // Generic KEY-123 prefix
  const generic = s.replace(/^[A-Z][A-Z0-9]+-\d+\s*[-–—:]?\s*/i, "").trim();
  return generic || s;
}

export function parseCategorieFromRiType(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const beforeSlash = t.split("/")[0]?.trim() ?? t;
  if (!beforeSlash) return null;
  if (beforeSlash.toLowerCase() === "run") return "RUN";
  return beforeSlash;
}

export function dateToQuarter(raw: string | Date | null | undefined): string | null {
  if (raw == null || raw === "") return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${q}`;
}

export function mapInitiativeStatus(statusName: string | null | undefined): string {
  const s = (statusName ?? "").normalize("NFKC").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (/\brisk\b|à risque|a risque|bloque|blocked|bloqué/i.test(s)) return "À risque";
  if (lower === "done" || lower === "closed" || lower === "resolved" || lower === "livré" || lower === "livre") {
    return "Livré";
  }
  if (lower === "in progress" || lower === "en cours" || lower === "in review") return "En cours";
  if (
    lower === "selected for development" ||
    lower === "to do" ||
    lower === "todo" ||
    lower === "open" ||
    lower === "backlog" ||
    lower === "new" ||
    lower === "non démarré" ||
    lower === "non demarre"
  ) {
    return "Non démarré";
  }
  return s;
}

/**
 * Value for the Excel Tags column: prefer NIS2/NIS/IA from the issue tags,
 * otherwise the first tag that is not "Reporting Annuel".
 */
export function pickExcelTag(tagValues: string[]): string | null {
  const cleaned = tagValues
    .map((v) => v.normalize("NFKC").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (const want of EXCEL_TAG_PRIORITY) {
    const hit = cleaned.find((t) => t.toLowerCase() === want.toLowerCase());
    if (hit) return hit;
  }
  for (const t of cleaned) {
    if (t.toLowerCase() === REPORTING_ANNUEL_TAG.toLowerCase()) continue;
    return t;
  }
  return null;
}

export function extractAdfPlainText(node: unknown): string | null {
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

export function formatJiraFieldValue(v: unknown): string | null {
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

export function readScalarField(fields: Record<string, unknown>, fieldId: string | undefined): string | null {
  if (!fieldId) return null;
  return formatJiraFieldValue(fields[fieldId]);
}

export function readNumberField(fields: Record<string, unknown>, fieldId: string | undefined): number | null {
  if (!fieldId) return null;
  const v = fields[fieldId];
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = formatJiraFieldValue(v);
  if (!s) return null;
  const n = Number(String(s).replace(",", ".").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function readMultiSelectValues(fields: Record<string, unknown>, fieldId: string | undefined): string[] {
  if (!fieldId) return [];
  const v = fields[fieldId];
  if (v == null) return [];
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (const item of v) {
      const s = formatJiraFieldValue(item);
      if (s) out.push(s);
    }
    return out;
  }
  const single = formatJiraFieldValue(v);
  return single ? [single] : [];
}

export function issueTypeName(fields: Record<string, unknown>): string | null {
  const it = fields.issuetype;
  if (!it || typeof it !== "object") return null;
  if ("name" in it) {
    const n = (it as { name: unknown }).name;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }
  return null;
}

export function statusName(fields: Record<string, unknown>): string {
  const s = fields.status;
  if (s && typeof s === "object" && s !== null && "name" in s) {
    return String((s as { name: unknown }).name);
  }
  return "";
}

export function assigneeDisplayName(fields: Record<string, unknown>): string | null {
  return formatJiraFieldValue(fields.assignee);
}

/** First Product linked via enables (outward preferred, then inward). */
export function firstEnablesLinkedProduct(
  fields: Record<string, unknown>,
  enablesType: string
): { key: string; summary: string | null } | null {
  const links = fields.issuelinks;
  if (!Array.isArray(links) || links.length === 0) return null;

  const want = enablesType.trim().toLowerCase();
  const candidates: Array<{ key: string; summary: string | null; outward: boolean }> = [];

  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const type = (link as { type?: unknown }).type;
    const typeName =
      type && typeof type === "object" && "name" in type
        ? String((type as { name?: unknown }).name ?? "").trim()
        : "";
    if (!typeName || typeName.toLowerCase() !== want) continue;

    const sides: Array<{ issue: unknown; outward: boolean }> = [];
    if ("outwardIssue" in link) sides.push({ issue: (link as { outwardIssue?: unknown }).outwardIssue, outward: true });
    if ("inwardIssue" in link) sides.push({ issue: (link as { inwardIssue?: unknown }).inwardIssue, outward: false });

    for (const { issue, outward } of sides) {
      if (!issue || typeof issue !== "object") continue;
      const key = "key" in issue ? String((issue as { key?: unknown }).key ?? "").trim() : "";
      if (!key) continue;
      const f =
        "fields" in issue && typeof (issue as { fields?: unknown }).fields === "object"
          ? ((issue as { fields?: unknown }).fields as Record<string, unknown>)
          : null;
      if (!f || issueTypeName(f) !== "Product") continue;
      const summary = formatJiraFieldValue(f.summary);
      candidates.push({ key, summary, outward });
    }
  }

  const outward = candidates.find((c) => c.outward);
  const hit = outward ?? candidates[0];
  return hit ? { key: hit.key, summary: hit.summary } : null;
}
