import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

export type BaselineOpt = {
  id: string;
  name: string;
  version: string;
  year: number;
  importedAt: string;
};

export type BaselineEotpRow = {
  eotp: string;
  eopLabel: string | null;
  amount: number;
};

export type BaselineCelluleRow = {
  cellule: string | null;
  amount: number;
};

export async function queryBaselines(): Promise<BaselineOpt[]> {
  const rows = await prisma.budgetBaseline.findMany({
    orderBy: { importedAt: "desc" },
    select: { id: true, name: true, version: true, year: true, importedAt: true },
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    version: b.version,
    year: b.year,
    importedAt: b.importedAt.toISOString(),
  }));
}

export async function queryBaselineByEotp(baselineId: string): Promise<BaselineEotpRow[]> {
  const rows = await prisma.$queryRaw<
    { eotp: string; eop_label: string | null; amount: unknown }[]
  >(Prisma.sql`
    SELECT
      d.eotp,
      d.eop_label,
      COALESCE(SUM(d.baseline_amount), 0)::double precision AS amount
    FROM v_baseline_detail d
    WHERE d.baseline_id = ${baselineId}
    GROUP BY d.eotp, d.eop_label
    ORDER BY amount DESC
  `);
  return rows.map((r) => ({
    eotp: r.eotp,
    eopLabel: r.eop_label,
    amount: Number(r.amount ?? 0),
  }));
}

export async function queryBaselineByCellule(baselineId: string): Promise<BaselineCelluleRow[]> {
  const rows = await prisma.$queryRaw<{ cellule: string | null; amount: unknown }[]>(
    Prisma.sql`
      SELECT
        d.cellule,
        COALESCE(SUM(d.baseline_amount), 0)::double precision AS amount
      FROM v_baseline_detail d
      WHERE d.baseline_id = ${baselineId}
      GROUP BY d.cellule
      ORDER BY amount DESC
    `
  );
  return rows.map((r) => ({ cellule: r.cellule, amount: Number(r.amount ?? 0) }));
}

