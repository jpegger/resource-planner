export function normalizeSummaryKey(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function firstComponentName(fields: Record<string, unknown>): string | null {
  const c = fields.components;
  if (!Array.isArray(c) || c.length === 0) return null;
  const x = c[0];
  if (x && typeof x === "object" && x !== null && "name" in x) {
    const n = (x as { name: unknown }).name;
    return typeof n === "string" && n.trim() ? n.trim() : null;
  }
  return null;
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

export function hasEnablesLinkToAnyProduct(fields: Record<string, unknown>, enablesType: string): boolean {
  const links = fields.issuelinks;
  if (!Array.isArray(links) || links.length === 0) return false;

  for (const link of links) {
    if (!link || typeof link !== "object") continue;
    const type = (link as { type?: unknown }).type;
    const typeName =
      type && typeof type === "object" && "name" in type ? String((type as { name?: unknown }).name ?? "").trim() : "";
    if (!typeName || typeName.toLowerCase() !== enablesType.toLowerCase()) continue;

    const candidates: unknown[] = [];
    if ("outwardIssue" in link) candidates.push((link as { outwardIssue?: unknown }).outwardIssue);
    if ("inwardIssue" in link) candidates.push((link as { inwardIssue?: unknown }).inwardIssue);

    for (const issue of candidates) {
      if (!issue || typeof issue !== "object") continue;
      const f =
        "fields" in issue && typeof (issue as { fields?: unknown }).fields === "object"
          ? (issue as { fields?: unknown }).fields
          : null;
      if (!f || typeof f !== "object") continue;
      if (issueTypeName(f as Record<string, unknown>) === "Product") return true;
    }
  }

  return false;
}

