import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * Resolve `initiative.id` (Jira key RI-…) from API/UI input.
 * Exact `findUnique` first; then case-insensitive SQL match — Prisma does not support
 * `mode: "insensitive"` on `@id` fields (runtime error → HTTP 500).
 */
export async function resolveInitiativeForApi(raw: string): Promise<{ id: string } | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const exact = await prisma.initiative.findUnique({
    where: { id: trimmed },
    select: { id: true },
  });
  if (exact) return exact;

  const rows = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM initiative WHERE LOWER(id) = LOWER(${trimmed}) LIMIT 1`
  );
  return rows[0] ?? null;
}
