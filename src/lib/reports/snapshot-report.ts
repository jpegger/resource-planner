import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

export type SnapshotOpt = {
  id: string;
  name: string;
  year: number;
  takenAt: string;
};

export type SnapshotRollupRow = {
  key: string;
  label: string;
  internal: number;
  external: number;
  direct: number;
  total: number;
  cashOut: number;
};

export type SnapshotLevel = "division" | "team" | "product" | "eotp";

export async function querySnapshots(): Promise<SnapshotOpt[]> {
  const rows = await prisma.allocationSnapshot.findMany({
    orderBy: { takenAt: "desc" },
    select: { id: true, name: true, year: true, takenAt: true },
  });
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    year: s.year,
    takenAt: s.takenAt.toISOString(),
  }));
}

export async function querySnapshotRollup(params: {
  snapshotId: string;
  level: SnapshotLevel;
  division: string | null;
  team: string | null;
  productName: string | null;
}): Promise<SnapshotRollupRow[]> {
  const { snapshotId, level, division, team, productName } = params;

  const where = Prisma.sql`
    WHERE d.snapshot_id = ${snapshotId}
    ${division === null ? Prisma.empty : Prisma.sql`AND d.division = ${division}`}
    ${team === null ? Prisma.empty : Prisma.sql`AND d.team = ${team}`}
    ${productName === null ? Prisma.empty : Prisma.sql`AND d.product_name = ${productName}`}
  `;

  if (level === "division") {
    const rows = await prisma.$queryRaw<
      {
        key: string | null;
        label: string | null;
        internal: unknown;
        external: unknown;
        direct: unknown;
        cash_out: unknown;
        total: unknown;
      }[]
    >(Prisma.sql`
      SELECT
        d.division AS key,
        d.division AS label,
        COALESCE(SUM(d.internal), 0)::double precision AS internal,
        COALESCE(SUM(d.external), 0)::double precision AS external,
        COALESCE(SUM(d.direct), 0)::double precision AS direct,
        COALESCE(SUM(d.cash_out), 0)::double precision AS cash_out,
        COALESCE(SUM(d.internal + d.external + d.direct), 0)::double precision AS total
      FROM v_snapshot_detail d
      ${where}
      GROUP BY d.division
      ORDER BY total DESC
    `);
    return rows.map((r) => ({
      key: r.key ?? "Unassigned",
      label: r.label ?? "Unassigned",
      internal: Number(r.internal ?? 0),
      external: Number(r.external ?? 0),
      direct: Number(r.direct ?? 0),
      cashOut: Number(r.cash_out ?? 0),
      total: Number(r.total ?? 0),
    }));
  }

  if (level === "team") {
    const rows = await prisma.$queryRaw<
      {
        key: string | null;
        label: string | null;
        internal: unknown;
        external: unknown;
        direct: unknown;
        cash_out: unknown;
        total: unknown;
      }[]
    >(Prisma.sql`
      SELECT
        COALESCE(d.team, 'Unassigned') AS key,
        COALESCE(d.team, 'Unassigned') AS label,
        COALESCE(SUM(d.internal), 0)::double precision AS internal,
        COALESCE(SUM(d.external), 0)::double precision AS external,
        COALESCE(SUM(d.direct), 0)::double precision AS direct,
        COALESCE(SUM(d.cash_out), 0)::double precision AS cash_out,
        COALESCE(SUM(d.internal + d.external + d.direct), 0)::double precision AS total
      FROM v_snapshot_detail d
      ${where}
      GROUP BY COALESCE(d.team, 'Unassigned')
      ORDER BY total DESC
    `);
    return rows.map((r) => ({
      key: r.key ?? "Unassigned",
      label: r.label ?? "Unassigned",
      internal: Number(r.internal ?? 0),
      external: Number(r.external ?? 0),
      direct: Number(r.direct ?? 0),
      cashOut: Number(r.cash_out ?? 0),
      total: Number(r.total ?? 0),
    }));
  }

  if (level === "product") {
    const rows = await prisma.$queryRaw<
      {
        key: string | null;
        label: string | null;
        internal: unknown;
        external: unknown;
        direct: unknown;
        cash_out: unknown;
        total: unknown;
      }[]
    >(Prisma.sql`
      SELECT
        COALESCE(d.product_name, 'Unassigned') AS key,
        COALESCE(d.product_name, 'Unassigned') AS label,
        COALESCE(SUM(d.internal), 0)::double precision AS internal,
        COALESCE(SUM(d.external), 0)::double precision AS external,
        COALESCE(SUM(d.direct), 0)::double precision AS direct,
        COALESCE(SUM(d.cash_out), 0)::double precision AS cash_out,
        COALESCE(SUM(d.internal + d.external + d.direct), 0)::double precision AS total
      FROM v_snapshot_detail d
      ${where}
      GROUP BY COALESCE(d.product_name, 'Unassigned')
      ORDER BY total DESC
    `);
    return rows.map((r) => ({
      key: r.key ?? "Unassigned",
      label: r.label ?? "Unassigned",
      internal: Number(r.internal ?? 0),
      external: Number(r.external ?? 0),
      direct: Number(r.direct ?? 0),
      cashOut: Number(r.cash_out ?? 0),
      total: Number(r.total ?? 0),
    }));
  }

  // eotp
  const rows = await prisma.$queryRaw<
    {
      key: string;
      label: string;
      internal: unknown;
      external: unknown;
      direct: unknown;
      cash_out: unknown;
      total: unknown;
    }[]
  >(Prisma.sql`
    SELECT
      d.eotp AS key,
      COALESCE(d.eop_label, d.eotp) AS label,
      COALESCE(SUM(d.internal), 0)::double precision AS internal,
      COALESCE(SUM(d.external), 0)::double precision AS external,
      COALESCE(SUM(d.direct), 0)::double precision AS direct,
      COALESCE(SUM(d.cash_out), 0)::double precision AS cash_out,
      COALESCE(SUM(d.internal + d.external + d.direct), 0)::double precision AS total
    FROM v_snapshot_detail d
    ${where}
    GROUP BY d.eotp, COALESCE(d.eop_label, d.eotp)
    ORDER BY total DESC
  `);

  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    internal: Number(r.internal ?? 0),
    external: Number(r.external ?? 0),
    direct: Number(r.direct ?? 0),
    cashOut: Number(r.cash_out ?? 0),
    total: Number(r.total ?? 0),
  }));
}

