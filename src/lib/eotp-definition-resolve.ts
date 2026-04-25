import type { PrismaClient } from "@/generated/prisma/client";

/** Resolve catalog row for a routing target SAP code. */
export async function resolveEotpDefinitionId(
  prisma: PrismaClient,
  eotp: string,
  _eopLabel: string | null | undefined
): Promise<string | null> {
  const code = eotp.trim();
  if (!code) return null;
  // Use findFirst instead of findUnique so this works both:
  // - before migration (no unique index on sapEotpCode in generated client yet)
  // - after migration (sapEotpCode is unique in the DB)
  const exact = await prisma.eotpDefinition.findFirst({
    where: { sapEotpCode: code },
    select: { id: true },
  });
  if (exact) return exact.id;

  const insensitive = await prisma.eotpDefinition.findFirst({
    where: { sapEotpCode: { equals: code, mode: "insensitive" } },
    select: { id: true },
  });
  return insensitive?.id ?? null;
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
  const rows = await prisma.eotpRouting.findMany({
    select: { id: true, eotp: true, eopLabel: true },
  });

  let linked = 0;
  for (const r of rows) {
    const eotpDefinitionId = await resolveEotpDefinitionId(
      prisma,
      r.eotp,
      r.eopLabel
    );
    await prisma.eotpRouting.update({
      where: { id: r.id },
      data: { eotpDefinitionId },
    });
    if (eotpDefinitionId) linked++;
  }

  return { processed: rows.length, linked };
}
