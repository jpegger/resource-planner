import { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/prisma";

export type ResourceAssignmentRow = {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  direction: string | null;
  cellule: string | null;
  function: string | null;
  internal: number;
  external: number;
  direct: number;
  total: number;
  /** Sum of FTE % (INTERNAL/EXTERNAL). Typically 0 for DIRECT_COST-only. */
  assignmentPct: number;
  manDays: number;
  buildInternal: number;
  buildExternal: number;
  buildDirect: number;
  totalBuild: number;
  buildAssignmentPct: number;
  buildManDays: number;
};

export type ResourceAssignmentDetailRow = {
  productName: string;
  jiraKey: string;
  summary: string;
  initiativeType: string | null;
  internal: number;
  external: number;
  direct: number;
  total: number;
  assignmentPct: number;
  manDays: number;
  buildInternal: number;
  buildExternal: number;
  buildDirect: number;
  totalBuild: number;
  buildAssignmentPct: number;
  buildManDays: number;
};

export type ResourceAssignmentDetailWithResource = ResourceAssignmentDetailRow & {
  resourceId: string;
};

export type ResourceAssignmentFilterOptions = {
  productFamilies: string[];
  products: string[];
  directions: string[];
  cellules: string[];
  functions: string[];
  initiativeTypes: string[];
};

export type ResourceAssignmentParams = {
  year: number;
  initiativeTypes: string[];
  productFamily: string | null;
  productName: string | null;
  direction: string | null;
  cellule: string | null;
  functionName: string | null;
  /** Empty = all. Values: INTERNAL | EXTERNAL | DIRECT_COST */
  resourceTypes: string[];
  resourceId?: string | null;
};

function whereInitiativeTypes(initiativeTypes: string[]) {
  if (!initiativeTypes.length) return Prisma.empty;
  const wantsUnassigned = initiativeTypes.some(
    (t) => t === "Unassigned" || t === "__UNASSIGNED__"
  );
  const named = initiativeTypes.filter(
    (t) => t !== "Unassigned" && t !== "__UNASSIGNED__"
  );
  if (wantsUnassigned && named.length === 0) {
    return Prisma.sql`AND (v.initiative_type IS NULL OR BTRIM(v.initiative_type) = '')`;
  }
  if (wantsUnassigned) {
    return Prisma.sql`AND (
      v.initiative_type IN (${Prisma.join(named)})
      OR v.initiative_type IS NULL
      OR BTRIM(v.initiative_type) = ''
    )`;
  }
  return Prisma.sql`AND v.initiative_type IN (${Prisma.join(named)})`;
}

function whereClause(params: ResourceAssignmentParams): Prisma.Sql {
  const {
    year,
    initiativeTypes,
    productFamily,
    productName,
    direction,
    cellule,
    functionName,
    resourceTypes,
    resourceId,
  } = params;

  return Prisma.sql`
    WHERE v.initiative_year = ${year}
    ${whereInitiativeTypes(initiativeTypes)}
    ${productFamily === null ? Prisma.empty : Prisma.sql`AND v.product_family = ${productFamily}`}
    ${productName === null ? Prisma.empty : Prisma.sql`AND v.product_name = ${productName}`}
    ${direction === null ? Prisma.empty : Prisma.sql`AND COALESCE(v.direction, '') = ${direction}`}
    ${cellule === null ? Prisma.empty : Prisma.sql`AND COALESCE(v.cellule, '') = ${cellule}`}
    ${
      functionName === null
        ? Prisma.empty
        : Prisma.sql`AND COALESCE(res.function, '') = ${functionName}`
    }
    ${
      resourceTypes.length === 0
        ? Prisma.empty
        : Prisma.sql`AND v.resource_type::text IN (${Prisma.join(resourceTypes)})`
    }
    ${
      resourceId == null || resourceId === ""
        ? Prisma.empty
        : Prisma.sql`AND v.resource_id = ${resourceId}`
    }
  `;
}

export async function queryResourceAssignmentFilterOptions(
  year: number
): Promise<ResourceAssignmentFilterOptions> {
  const rows = await prisma.$queryRaw<
    {
      product_families: string[] | null;
      products: string[] | null;
      directions: string[] | null;
      cellules: string[] | null;
      functions: string[] | null;
      initiative_types: string[] | null;
    }[]
  >(Prisma.sql`
    SELECT
      ARRAY(
        SELECT DISTINCT v.product_family
        FROM v_allocation_costs v
        WHERE v.initiative_year = ${year}
        ORDER BY 1
      ) AS product_families,
      ARRAY(
        SELECT DISTINCT v.product_name
        FROM v_allocation_costs v
        WHERE v.initiative_year = ${year}
        ORDER BY 1
      ) AS products,
      ARRAY(
        SELECT DISTINCT COALESCE(v.direction, '')
        FROM v_allocation_costs v
        WHERE v.initiative_year = ${year} AND COALESCE(v.direction, '') <> ''
        ORDER BY 1
      ) AS directions,
      ARRAY(
        SELECT DISTINCT COALESCE(v.cellule, '')
        FROM v_allocation_costs v
        WHERE v.initiative_year = ${year} AND COALESCE(v.cellule, '') <> ''
        ORDER BY 1
      ) AS cellules,
      ARRAY(
        SELECT DISTINCT COALESCE(res.function, '')
        FROM v_allocation_costs v
        JOIN resource res ON res.id = v.resource_id
        WHERE v.initiative_year = ${year} AND COALESCE(res.function, '') <> ''
        ORDER BY 1
      ) AS functions,
      ARRAY(
        SELECT DISTINCT COALESCE(NULLIF(BTRIM(v.initiative_type), ''), 'Unassigned')
        FROM v_allocation_costs v
        WHERE v.initiative_year = ${year}
        ORDER BY 1
      ) AS initiative_types
  `);

  const r = rows[0];
  return {
    productFamilies: r?.product_families ?? [],
    products: r?.products ?? [],
    directions: r?.directions ?? [],
    cellules: r?.cellules ?? [],
    functions: r?.functions ?? [],
    initiativeTypes: r?.initiative_types ?? [],
  };
}

export async function queryResourceAssignmentList(
  params: ResourceAssignmentParams
): Promise<ResourceAssignmentRow[]> {
  const where = whereClause({ ...params, resourceId: null });

  const rows = await prisma.$queryRaw<
    {
      resource_id: string;
      resource_name: string;
      resource_type: string;
      direction: string | null;
      cellule: string | null;
      function: string | null;
      internal: unknown;
      external: unknown;
      direct: unknown;
      total: unknown;
      assignment_pct: unknown;
      man_days: unknown;
      build_internal: unknown;
      build_external: unknown;
      build_direct: unknown;
      total_build: unknown;
      build_assignment_pct: unknown;
      build_man_days: unknown;
    }[]
  >(Prisma.sql`
    SELECT
      v.resource_id,
      v.resource_name,
      v.resource_type::text AS resource_type,
      v.direction,
      v.cellule,
      res.function,
      COALESCE(SUM(v.internal_cost), 0)::double precision AS internal,
      COALESCE(SUM(v.external_cost), 0)::double precision AS external,
      COALESCE(SUM(v.direct_cost), 0)::double precision AS direct,
      COALESCE(SUM(v.computed_cost), 0)::double precision AS total,
      COALESCE(SUM(v.fte_percent), 0)::double precision AS assignment_pct,
      COALESCE(SUM(v.calculated_man_days), 0)::double precision AS man_days,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.internal_cost ELSE 0 END
      ), 0)::double precision AS build_internal,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.external_cost ELSE 0 END
      ), 0)::double precision AS build_external,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.direct_cost ELSE 0 END
      ), 0)::double precision AS build_direct,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.computed_cost ELSE 0 END
      ), 0)::double precision AS total_build,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.fte_percent ELSE 0 END
      ), 0)::double precision AS build_assignment_pct,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.calculated_man_days ELSE 0 END
      ), 0)::double precision AS build_man_days
    FROM v_allocation_costs v
    JOIN resource res ON res.id = v.resource_id
    ${where}
    GROUP BY v.resource_id, v.resource_name, v.resource_type, v.direction, v.cellule, res.function
    ORDER BY v.resource_name ASC
  `);

  return rows.map((r) => ({
    resourceId: r.resource_id,
    resourceName: r.resource_name,
    resourceType: r.resource_type,
    direction: r.direction,
    cellule: r.cellule,
    function: r.function,
    internal: Number(r.internal ?? 0),
    external: Number(r.external ?? 0),
    direct: Number(r.direct ?? 0),
    total: Number(r.total ?? 0),
    assignmentPct: Number(r.assignment_pct ?? 0),
    manDays: Number(r.man_days ?? 0),
    buildInternal: Number(r.build_internal ?? 0),
    buildExternal: Number(r.build_external ?? 0),
    buildDirect: Number(r.build_direct ?? 0),
    totalBuild: Number(r.total_build ?? 0),
    buildAssignmentPct: Number(r.build_assignment_pct ?? 0),
    buildManDays: Number(r.build_man_days ?? 0),
  }));
}

export async function queryResourceAssignmentDetail(
  params: ResourceAssignmentParams & { resourceId: string }
): Promise<ResourceAssignmentDetailRow[]> {
  const where = whereClause(params);

  const rows = await prisma.$queryRaw<
    {
      product_name: string;
      jira_key: string;
      summary: string;
      initiative_type: string | null;
      internal: unknown;
      external: unknown;
      direct: unknown;
      total: unknown;
      assignment_pct: unknown;
      man_days: unknown;
      build_internal: unknown;
      build_external: unknown;
      build_direct: unknown;
      total_build: unknown;
      build_assignment_pct: unknown;
      build_man_days: unknown;
    }[]
  >(Prisma.sql`
    SELECT
      v.product_name,
      v.jira_key,
      v.summary,
      v.initiative_type,
      COALESCE(SUM(v.internal_cost), 0)::double precision AS internal,
      COALESCE(SUM(v.external_cost), 0)::double precision AS external,
      COALESCE(SUM(v.direct_cost), 0)::double precision AS direct,
      COALESCE(SUM(v.computed_cost), 0)::double precision AS total,
      COALESCE(SUM(v.fte_percent), 0)::double precision AS assignment_pct,
      COALESCE(SUM(v.calculated_man_days), 0)::double precision AS man_days,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.internal_cost ELSE 0 END
      ), 0)::double precision AS build_internal,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.external_cost ELSE 0 END
      ), 0)::double precision AS build_external,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.direct_cost ELSE 0 END
      ), 0)::double precision AS build_direct,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.computed_cost ELSE 0 END
      ), 0)::double precision AS total_build,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.fte_percent ELSE 0 END
      ), 0)::double precision AS build_assignment_pct,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.calculated_man_days ELSE 0 END
      ), 0)::double precision AS build_man_days
    FROM v_allocation_costs v
    JOIN resource res ON res.id = v.resource_id
    ${where}
    GROUP BY v.product_name, v.jira_key, v.summary, v.initiative_type
    ORDER BY v.product_name ASC, total DESC, v.jira_key ASC
  `);

  return rows.map((r) => ({
    productName: r.product_name,
    jiraKey: r.jira_key,
    summary: r.summary,
    initiativeType: r.initiative_type,
    internal: Number(r.internal ?? 0),
    external: Number(r.external ?? 0),
    direct: Number(r.direct ?? 0),
    total: Number(r.total ?? 0),
    assignmentPct: Number(r.assignment_pct ?? 0),
    manDays: Number(r.man_days ?? 0),
    buildInternal: Number(r.build_internal ?? 0),
    buildExternal: Number(r.build_external ?? 0),
    buildDirect: Number(r.build_direct ?? 0),
    totalBuild: Number(r.total_build ?? 0),
    buildAssignmentPct: Number(r.build_assignment_pct ?? 0),
    buildManDays: Number(r.build_man_days ?? 0),
  }));
}

/** All initiative lines for every resource matching the filters (for expanded list overview). */
export async function queryResourceAssignmentDetailsAll(
  params: ResourceAssignmentParams
): Promise<ResourceAssignmentDetailWithResource[]> {
  const where = whereClause({ ...params, resourceId: null });

  const rows = await prisma.$queryRaw<
    {
      resource_id: string;
      product_name: string;
      jira_key: string;
      summary: string;
      initiative_type: string | null;
      internal: unknown;
      external: unknown;
      direct: unknown;
      total: unknown;
      assignment_pct: unknown;
      man_days: unknown;
      build_internal: unknown;
      build_external: unknown;
      build_direct: unknown;
      total_build: unknown;
      build_assignment_pct: unknown;
      build_man_days: unknown;
    }[]
  >(Prisma.sql`
    SELECT
      v.resource_id,
      v.product_name,
      v.jira_key,
      v.summary,
      v.initiative_type,
      COALESCE(SUM(v.internal_cost), 0)::double precision AS internal,
      COALESCE(SUM(v.external_cost), 0)::double precision AS external,
      COALESCE(SUM(v.direct_cost), 0)::double precision AS direct,
      COALESCE(SUM(v.computed_cost), 0)::double precision AS total,
      COALESCE(SUM(v.fte_percent), 0)::double precision AS assignment_pct,
      COALESCE(SUM(v.calculated_man_days), 0)::double precision AS man_days,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.internal_cost ELSE 0 END
      ), 0)::double precision AS build_internal,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.external_cost ELSE 0 END
      ), 0)::double precision AS build_external,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.direct_cost ELSE 0 END
      ), 0)::double precision AS build_direct,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.computed_cost ELSE 0 END
      ), 0)::double precision AS total_build,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.fte_percent ELSE 0 END
      ), 0)::double precision AS build_assignment_pct,
      COALESCE(SUM(
        CASE WHEN COALESCE(v.initiative_type, '') IS DISTINCT FROM 'Run'
          THEN v.calculated_man_days ELSE 0 END
      ), 0)::double precision AS build_man_days
    FROM v_allocation_costs v
    JOIN resource res ON res.id = v.resource_id
    ${where}
    GROUP BY v.resource_id, v.resource_name, v.product_name, v.jira_key, v.summary, v.initiative_type
    ORDER BY v.resource_name ASC, v.product_name ASC, total DESC, v.jira_key ASC
  `);

  return rows.map((r) => ({
    resourceId: r.resource_id,
    productName: r.product_name,
    jiraKey: r.jira_key,
    summary: r.summary,
    initiativeType: r.initiative_type,
    internal: Number(r.internal ?? 0),
    external: Number(r.external ?? 0),
    direct: Number(r.direct ?? 0),
    total: Number(r.total ?? 0),
    assignmentPct: Number(r.assignment_pct ?? 0),
    manDays: Number(r.man_days ?? 0),
    buildInternal: Number(r.build_internal ?? 0),
    buildExternal: Number(r.build_external ?? 0),
    buildDirect: Number(r.build_direct ?? 0),
    totalBuild: Number(r.total_build ?? 0),
    buildAssignmentPct: Number(r.build_assignment_pct ?? 0),
    buildManDays: Number(r.build_man_days ?? 0),
  }));
}
