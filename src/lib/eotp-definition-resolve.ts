import type { PrismaClient } from "@/generated/prisma/client";

type EotpPickRow = { id: string; label: string };

/** Strip trailing ` … 7D00…` suffix often present on routing labels but not on budget CSV labels. */
export function stripTrailingSapCodeFromLabel(label: string): string {
  return label.replace(/\s+7D[0-9A-Za-z]+\s*$/i, "").trim();
}

/** Normalize for comparing routing labels to `eotp_definition.label`. */
export function normalizeEotpLabelForMatch(raw: string): string {
  let s = stripTrailingSapCodeFromLabel(raw.trim());
  s = s.replace(/Plateforme Commune/gi, "Plateforme commune");
  return s.toLowerCase();
}

/** Pick one catalog row when several share the same SAP code (match label, else fuzzy, else first). */
export function pickEotpDefinitionId(
  candidates: EotpPickRow[],
  eopLabel: string | null | undefined
): string | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].id;
  const routingNorm = normalizeEotpLabelForMatch(eopLabel ?? "");
  const exact = candidates.find(
    (c) => normalizeEotpLabelForMatch(c.label) === routingNorm
  );
  if (exact) return exact.id;
  if (routingNorm) {
    const partial = candidates.find((c) => {
      const cat = normalizeEotpLabelForMatch(c.label);
      return (
        routingNorm.includes(cat) ||
        cat.includes(routingNorm) ||
        routingNorm.includes(cat.replace(/_/g, " ")) ||
        cat.includes(routingNorm.replace(/_/g, " "))
      );
    });
    if (partial) return partial.id;
  }
  return candidates[0].id;
}

/** Build map: normalized SAP code → rows (for batch seeding). */
export function eotpDefinitionsByCode(
  definitions: Array<{ id: string; sapEotpCode: string; label: string }>
): Map<string, Array<{ id: string; label: string }>> {
  const m = new Map<string, Array<{ id: string; label: string }>>();
  for (const d of definitions) {
    const k = d.sapEotpCode.trim().toLowerCase();
    if (!k) continue;
    const list = m.get(k) ?? [];
    list.push({ id: d.id, label: d.label });
    m.set(k, list);
  }
  return m;
}

/** Load definitions for `eotp` with exact match first, then case-insensitive SAP code. */
async function findDefinitionsForSapCode(
  prisma: PrismaClient,
  code: string
): Promise<Array<{ id: string; label: string }>> {
  const trimmed = code.trim();
  if (!trimmed) return [];
  let rows = await prisma.eotpDefinition.findMany({
    where: { sapEotpCode: trimmed },
    select: { id: true, label: true },
  });
  if (rows.length > 0) return rows;
  rows = await prisma.eotpDefinition.findMany({
    where: { sapEotpCode: { equals: trimmed, mode: "insensitive" } },
    select: { id: true, label: true },
  });
  return rows;
}

/** Resolve catalog row for a routing target code + label (ambiguous when multiple definitions share a SAP code). */
export async function resolveEotpDefinitionId(
  prisma: PrismaClient,
  eotp: string,
  eopLabel: string | null | undefined
): Promise<string | null> {
  const code = eotp.trim();
  if (!code) return null;
  const candidates = await findDefinitionsForSapCode(prisma, code);
  return pickEotpDefinitionId(candidates, eopLabel);
}

/** Link allocation entities to `eotp_definition` by matching SAP code (+ label when ambiguous). */
export async function linkAllocationEntitiesToEotpDefinitions(
  prisma: PrismaClient
): Promise<void> {
  const entities = await prisma.allocationEntity.findMany({
    select: { id: true, sapEotpCode: true, sapEotpName: true },
  });
  for (const e of entities) {
    const id = await resolveEotpDefinitionId(
      prisma,
      e.sapEotpCode ?? "",
      e.sapEotpName ?? ""
    );
    await prisma.allocationEntity.update({
      where: { id: e.id },
      data: { eotpDefinitionId: id },
    });
  }
}

/**
 * Set `eotp_routing.eotp_definition_id` for every row from `eotp` + `eopLabel`.
 * Run after `db:seed:eotp` (or whenever the catalog was empty when routing rows were created).
 */
export async function backfillEotpRoutingDefinitionIds(
  prisma: PrismaClient
): Promise<{ processed: number; linked: number }> {
  const defs = await prisma.eotpDefinition.findMany({
    select: { id: true, sapEotpCode: true, label: true },
  });
  const byCode = eotpDefinitionsByCode(defs);
  const rows = await prisma.eotpRouting.findMany({
    select: { id: true, eotp: true, eopLabel: true },
  });

  let linked = 0;
  for (const r of rows) {
    const key = r.eotp.trim().toLowerCase();
    let candidates = byCode.get(key) ?? [];
    if (candidates.length === 0 && r.eotp.trim()) {
      const fromDb = await findDefinitionsForSapCode(prisma, r.eotp);
      candidates = fromDb;
    }
    const eotpDefinitionId = pickEotpDefinitionId(candidates, r.eopLabel);
    await prisma.eotpRouting.update({
      where: { id: r.id },
      data: { eotpDefinitionId },
    });
    if (eotpDefinitionId) linked++;
  }

  return { processed: rows.length, linked };
}
