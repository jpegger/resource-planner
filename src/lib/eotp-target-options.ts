import { eotpTargetsProductMain } from "@/lib/eotp-routing-validation";

/** One selectable EOTP routing target from `eotp_definition`. */
export type EotpTargetOption = {
  /** Stable id for React keys / selection (`eotp_definition.id`). */
  rowId: string;
  code: string;
  label: string;
  /** Secondary line — team · budget owner. */
  entityName: string;
  /** Search helper (e.g. division). */
  productFamily?: string;
};

export type EotpDefinitionOptionRow = {
  id: string;
  sapEotpCode: string;
  label: string;
  team: string | null;
  budgetOwner: string | null;
  division: string | null;
};

function secondaryLine(d: EotpDefinitionOptionRow): string {
  const parts = [d.team?.trim(), d.budgetOwner?.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "EOTP catalog";
}

/**
 * Build combobox options from `eotp_definition` only, excluding the product’s main SAP code.
 */
export function buildEotpTargetOptions(
  definitions: EotpDefinitionOptionRow[],
  mainSapEotpCode: string | null | undefined
): EotpTargetOption[] {
  const opts: EotpTargetOption[] = [];

  for (const d of definitions) {
    const code = d.sapEotpCode.trim();
    if (!code) continue;
    if (eotpTargetsProductMain(code, mainSapEotpCode)) continue;
    opts.push({
      rowId: d.id,
      code,
      label: d.label.trim(),
      entityName: secondaryLine(d),
      productFamily: d.division?.trim() || undefined,
    });
  }

  opts.sort((a, b) => {
    const laRaw = (a.label || "").trim();
    const lbRaw = (b.label || "").trim();
    const aEmpty = !laRaw;
    const bEmpty = !lbRaw;
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    const la = laRaw.toLowerCase();
    const lb = lbRaw.toLowerCase();
    const byLabel = la.localeCompare(lb, undefined, { sensitivity: "base" });
    if (byLabel !== 0) return byLabel;
    return a.code.localeCompare(b.code, undefined, { sensitivity: "base" });
  });

  return opts;
}
