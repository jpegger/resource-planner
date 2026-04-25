import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

export type EotpProductRow = {
  productId: string;
  productName: string;
  mainEotp: string;
  mainEopLabel: string | null;
  total: number;
};

export type EotpTotalsRow = {
  eotp: string;
  eopLabel: string | null;
  total: number;
};

export type EotpProductsForEotpRow = {
  productId: string;
  productName: string;
  total: number;
};

export type EotpLinesFilters = {
  divisions: string[];
  subDivisions: string[];
  teams: string[];
};

export type EotpLinesFilterParams = {
  division?: string;
  subDivision?: string;
  team?: string;
};

export type EotpRow = {
  eotp: string;
  eopLabel: string | null;
  isMain: boolean;
  internal: number;
  external: number;
  direct: number;
  cashOut: number;
  total: number;
};

export type EotpRoutingRow = {
  id: string;
  eotp: string;
  eopLabel: string | null;
  internalAmount: number;
  externalAmount: number;
  directAmount: number;
  total: number;
  comment: string | null;
};

export type InitiativeCostRow = {
  jiraKey: string;
  summary: string;
  internal: number;
  external: number;
  direct: number;
  total: number;
};

export async function queryEotpProducts(year: number): Promise<EotpProductRow[]> {
  const rows = await prisma.$queryRaw<
    {
      product_id: string;
      product_name: string;
      main_eotp: string;
      main_eop_label: string | null;
      total: unknown;
    }[]
  >(Prisma.sql`
    SELECT
      v.product_id,
      v.product_name,
      MAX(CASE WHEN v.is_main_eotp THEN v.eotp END) AS main_eotp,
      MAX(CASE WHEN v.is_main_eotp THEN v.eop_label END) AS main_eop_label,
      COALESCE(SUM(CASE WHEN v.is_main_eotp THEN v.total_cost ELSE 0 END), 0)::double precision AS total
    FROM v_eotp_costs v
    WHERE v.year = ${year}
    GROUP BY v.product_id, v.product_name
    ORDER BY total DESC
  `);
  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    mainEotp: r.main_eotp,
    mainEopLabel: r.main_eop_label,
    total: Number(r.total ?? 0),
  }));
}

export async function queryEotpLinesFilters(year: number): Promise<EotpLinesFilters> {
  const rows = await prisma.$queryRaw<
    { division: string | null; sub_division: string | null; team: string | null }[]
  >(Prisma.sql`
    SELECT DISTINCT
      p.division,
      p."subDivision" AS sub_division,
      p.team
    FROM v_eotp_costs v
    JOIN allocation_entity p ON p.id = v.product_id
    WHERE v.year = ${year}
  `);

  const uniq = (xs: Array<string | null | undefined>) =>
    Array.from(new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );

  return {
    divisions: uniq(rows.map((r) => r.division)),
    subDivisions: uniq(rows.map((r) => r.sub_division)),
    teams: uniq(rows.map((r) => r.team)),
  };
}

export async function queryEotpTotals(
  year: number,
  filters?: EotpLinesFilterParams
): Promise<EotpTotalsRow[]> {
  const where: Prisma.Sql[] = [Prisma.sql`v.year = ${year}`];
  if (filters?.division) where.push(Prisma.sql`p.division = ${filters.division}`);
  if (filters?.subDivision) where.push(Prisma.sql`p."subDivision" = ${filters.subDivision}`);
  if (filters?.team) where.push(Prisma.sql`p.team = ${filters.team}`);

  let whereSql = Prisma.sql``;
  for (const [idx, cond] of where.entries()) {
    whereSql = idx === 0 ? Prisma.sql`${cond}` : Prisma.sql`${whereSql} AND ${cond}`;
  }

  const rows = await prisma.$queryRaw<
    { eotp: string; eop_label: string | null; total: unknown }[]
  >(Prisma.sql`
    SELECT
      v.eotp,
      MAX(v.eop_label) AS eop_label,
      COALESCE(SUM(v.total_cost), 0)::double precision AS total
    FROM v_eotp_costs v
    JOIN allocation_entity p ON p.id = v.product_id
    WHERE ${whereSql}
    GROUP BY v.eotp
    ORDER BY total DESC
  `);
  return rows.map((r) => ({ eotp: r.eotp, eopLabel: r.eop_label, total: Number(r.total ?? 0) }));
}

export async function queryProductsForEotp(
  year: number,
  eotp: string,
  filters?: EotpLinesFilterParams
): Promise<EotpProductsForEotpRow[]> {
  const where: Prisma.Sql[] = [Prisma.sql`v.year = ${year}`, Prisma.sql`v.eotp = ${eotp}`];
  if (filters?.division) where.push(Prisma.sql`p.division = ${filters.division}`);
  if (filters?.subDivision) where.push(Prisma.sql`p."subDivision" = ${filters.subDivision}`);
  if (filters?.team) where.push(Prisma.sql`p.team = ${filters.team}`);

  let whereSql = Prisma.sql``;
  for (const [idx, cond] of where.entries()) {
    whereSql = idx === 0 ? Prisma.sql`${cond}` : Prisma.sql`${whereSql} AND ${cond}`;
  }

  const rows = await prisma.$queryRaw<
    { product_id: string; product_name: string; total: unknown }[]
  >(Prisma.sql`
    SELECT
      v.product_id,
      v.product_name,
      COALESCE(SUM(v.total_cost), 0)::double precision AS total
    FROM v_eotp_costs v
    JOIN allocation_entity p ON p.id = v.product_id
    WHERE ${whereSql}
    GROUP BY v.product_id, v.product_name
    ORDER BY total DESC
  `);
  return rows.map((r) => ({
    productId: r.product_id,
    productName: r.product_name,
    total: Number(r.total ?? 0),
  }));
}

export async function queryEotpRowsForProduct(
  year: number,
  productId: string
): Promise<EotpRow[]> {
  const rows = await prisma.$queryRaw<
    {
      eotp: string;
      eop_label: string | null;
      is_main_eotp: boolean;
      internal_cost: unknown;
      external_cost: unknown;
      direct_cost: unknown;
      cash_out: unknown;
      total_cost: unknown;
    }[]
  >(Prisma.sql`
    SELECT
      v.eotp,
      v.eop_label,
      v.is_main_eotp,
      v.internal_cost,
      v.external_cost,
      v.direct_cost,
      v.cash_out,
      v.total_cost
    FROM v_eotp_costs v
    WHERE v.year = ${year}
      AND v.product_id = ${productId}
    ORDER BY v.is_main_eotp DESC, v.total_cost DESC
  `);
  return rows.map((r) => ({
    eotp: r.eotp,
    eopLabel: r.eop_label,
    isMain: Boolean(r.is_main_eotp),
    internal: Number(r.internal_cost ?? 0),
    external: Number(r.external_cost ?? 0),
    direct: Number(r.direct_cost ?? 0),
    cashOut: Number(r.cash_out ?? 0),
    total: Number(r.total_cost ?? 0),
  }));
}

export async function queryRoutingRows(
  year: number,
  productId: string
): Promise<EotpRoutingRow[]> {
  const rows = await prisma.$queryRaw<
    {
      id: string;
      eotp: string;
      eopLabel: string | null;
      internalAmount: unknown;
      externalAmount: unknown;
      directAmount: unknown;
      comment: string | null;
    }[]
  >(Prisma.sql`
    SELECT
      er.id,
      er.eotp,
      er."eopLabel",
      er."internalAmount",
      er."externalAmount",
      er."directAmount",
      er.comment
    FROM eotp_routing er
    WHERE er.year = ${year}
      AND er."allocation_entity_id" = ${productId}
    ORDER BY (er."internalAmount" + er."externalAmount" + er."directAmount") DESC
  `);
  return rows.map((r) => ({
    id: r.id,
    eotp: r.eotp,
    eopLabel: r.eopLabel,
    internalAmount: Number(r.internalAmount ?? 0),
    externalAmount: Number(r.externalAmount ?? 0),
    directAmount: Number(r.directAmount ?? 0),
    total:
      Number(r.internalAmount ?? 0) +
      Number(r.externalAmount ?? 0) +
      Number(r.directAmount ?? 0),
    comment: r.comment,
  }));
}

export async function queryInitiativeCostsForProduct(
  year: number,
  productId: string
): Promise<InitiativeCostRow[]> {
  const rows = await prisma.$queryRaw<
    {
      jira_key: string;
      summary: string;
      internal: unknown;
      external: unknown;
      direct: unknown;
      total: unknown;
    }[]
  >(Prisma.sql`
    SELECT
      v.jira_key,
      MAX(v.summary) AS summary,
      COALESCE(SUM(v.internal_cost), 0)::double precision AS internal,
      COALESCE(SUM(v.external_cost), 0)::double precision AS external,
      COALESCE(SUM(v.direct_cost), 0)::double precision AS direct,
      COALESCE(SUM(v.computed_cost), 0)::double precision AS total
    FROM v_allocation_costs v
    JOIN initiative i ON i.id = v.jira_key
    WHERE v.initiative_year = ${year}
      AND i."allocation_entity_id" = ${productId}
    GROUP BY v.jira_key
    ORDER BY total DESC
  `);
  return rows.map((r) => ({
    jiraKey: r.jira_key,
    summary: r.summary,
    internal: Number(r.internal ?? 0),
    external: Number(r.external ?? 0),
    direct: Number(r.direct ?? 0),
    total: Number(r.total ?? 0),
  }));
}

