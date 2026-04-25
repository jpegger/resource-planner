import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  snapshotId: z.string().trim().min(1),
  baselineId: z.string().trim().min(1),
  division: z.string().trim().min(1).optional(),
  subdivision: z.string().trim().min(1).optional(),
  team: z.string().trim().min(1).optional(),
  owner: z.string().trim().min(1).optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: searchParams.get("year"),
      snapshotId: searchParams.get("snapshotId"),
      baselineId: searchParams.get("baselineId"),
      division: searchParams.get("division") ?? undefined,
      subdivision: searchParams.get("subdivision") ?? undefined,
      team: searchParams.get("team") ?? undefined,
      owner: searchParams.get("owner") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const { year, snapshotId, baselineId, division, subdivision, team, owner } = parsed.data;

    const divFilter = division ? Prisma.sql`AND division = ${division}` : Prisma.empty;
    const subFilter = subdivision
      ? Prisma.sql`AND sub_division = ${subdivision}`
      : Prisma.empty;
    const teamFilter = team ? Prisma.sql`AND team = ${team}` : Prisma.empty;
    const ownFilter = owner ? Prisma.sql`AND owner = ${owner}` : Prisma.empty;

    const rows = await prisma.$queryRaw<
      {
        eotp: string;
        label: string;
        division: string | null;
        sub_division: string | null;
        team: string | null;
        owner: string | null;
        snapshot_id: string | null;
        year: number | null;
        baseline_id: string | null;
        snap_internal: unknown;
        snap_external: unknown;
        snap_direct: unknown;
        snap_catchout: unknown;
        baseline_amount: unknown;
        gap: unknown;
      }[]
    >(Prisma.sql`
      SELECT *
      FROM v_comparison
      WHERE snapshot_id = ${snapshotId}
        AND baseline_id = ${baselineId}
        AND year = ${year}
        ${divFilter}
        ${subFilter}
        ${teamFilter}
        ${ownFilter}
      ORDER BY division, sub_division, team, owner, eotp
    `);

    return NextResponse.json(
      rows.map((r) => ({
        eotp: r.eotp,
        label: r.label,
        division: r.division,
        subdivision: r.sub_division,
        team: r.team,
        owner: r.owner,
        snapshotId: r.snapshot_id,
        year: r.year,
        baselineId: r.baseline_id,
        snapInternal: Number(r.snap_internal ?? 0),
        snapExternal: Number(r.snap_external ?? 0),
        snapDirect: Number(r.snap_direct ?? 0),
        snapCatchout: Number(r.snap_catchout ?? 0),
        baselineAmount: Number(r.baseline_amount ?? 0),
        gap: Number(r.gap ?? 0),
      })),
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/reports/comparison]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

