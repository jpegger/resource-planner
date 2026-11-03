import { NextResponse } from "next/server";
import { z } from "zod";

import {
  queryResourceAssignmentDetail,
  queryResourceAssignmentDetailsAll,
  queryResourceAssignmentFilterOptions,
  queryResourceAssignmentList,
} from "@/lib/reports/resource-assignment-rollup";

export const runtime = "nodejs";

const levelSchema = z.enum(["resource", "detail"]);

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  level: levelSchema.default("resource"),
  resourceId: z.string().trim().min(1).optional(),
  productFamily: z.string().trim().min(1).optional(),
  productName: z.string().trim().min(1).optional(),
  direction: z.string().trim().min(1).optional(),
  cellule: z.string().trim().min(1).optional(),
  functionName: z.string().trim().min(1).optional(),
  initiativeTypes: z.string().trim().optional(),
  resourceTypes: z.string().trim().optional(),
  includeDetails: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
});

function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: searchParams.get("year"),
      level: searchParams.get("level") ?? undefined,
      resourceId: searchParams.get("resourceId") ?? undefined,
      productFamily: searchParams.get("productFamily") ?? undefined,
      productName: searchParams.get("productName") ?? undefined,
      direction: searchParams.get("direction") ?? undefined,
      cellule: searchParams.get("cellule") ?? undefined,
      functionName: searchParams.get("functionName") ?? undefined,
      initiativeTypes: searchParams.get("initiativeTypes") ?? undefined,
      resourceTypes: searchParams.get("resourceTypes") ?? undefined,
      includeDetails: searchParams.get("includeDetails") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }

    const {
      year,
      level,
      resourceId,
      productFamily,
      productName,
      direction,
      cellule,
      functionName,
      initiativeTypes,
      resourceTypes,
      includeDetails,
    } = parsed.data;

    if (level === "detail" && !resourceId) {
      return NextResponse.json(
        { error: "resourceId is required when level=detail" },
        { status: 400 }
      );
    }

    const params = {
      year,
      initiativeTypes: parseCsv(initiativeTypes),
      productFamily: productFamily ?? null,
      productName: productName ?? null,
      direction: direction ?? null,
      cellule: cellule ?? null,
      functionName: functionName ?? null,
      resourceTypes: parseCsv(resourceTypes),
      resourceId: resourceId ?? null,
    };

    const filterOptionsPromise = queryResourceAssignmentFilterOptions(year);

    if (level === "detail" && resourceId) {
      const [filterOptions, rows] = await Promise.all([
        filterOptionsPromise,
        queryResourceAssignmentDetail({ ...params, resourceId }),
      ]);
      return NextResponse.json(
        {
          rows,
          details: [],
          filterOptions,
          meta: {
            year,
            level,
            resourceId,
            includeDetails: false,
            productFamily: productFamily ?? null,
            productName: productName ?? null,
            direction: direction ?? null,
            cellule: cellule ?? null,
            functionName: functionName ?? null,
            initiativeTypes: params.initiativeTypes,
            resourceTypes: params.resourceTypes,
          },
        },
        { status: 200 }
      );
    }

    const [filterOptions, rows, details] = await Promise.all([
      filterOptionsPromise,
      queryResourceAssignmentList(params),
      includeDetails ? queryResourceAssignmentDetailsAll(params) : Promise.resolve([]),
    ]);

    return NextResponse.json(
      {
        rows,
        details,
        filterOptions,
        meta: {
          year,
          level,
          resourceId: null,
          includeDetails: Boolean(includeDetails),
          productFamily: productFamily ?? null,
          productName: productName ?? null,
          direction: direction ?? null,
          cellule: cellule ?? null,
          functionName: functionName ?? null,
          initiativeTypes: params.initiativeTypes,
          resourceTypes: params.resourceTypes,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[GET /api/reports/resource-assignments]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
