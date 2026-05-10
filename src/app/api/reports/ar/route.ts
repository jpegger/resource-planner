import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import type {
  ArMatchedInvoice,
  ArReportLine,
  ArReportResponse,
  ArReportSummary,
} from "@/lib/ar-report-types";
import { prisma } from "@/lib/prisma";
import { AR_DOCUMENT_STATUSES, type ArDocumentStatus } from "@/lib/sf-ar-parser";

export const runtime = "nodejs";

const DOC_OK = new Set<ArDocumentStatus>(AR_DOCUMENT_STATUSES);

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function trimOpt(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s && s.length ? s : undefined));
}

const querySchema = z.object({
  year: z.coerce.number().int().min(1990).max(2100),
  status: z
    .string()
    .optional()
    .transform((s) => {
      if (s == null || !s.trim()) return undefined;
      return s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    })
    .superRefine((arr, ctx) => {
      if (!arr?.length) return;
      for (const x of arr) {
        if (!DOC_OK.has(x as ArDocumentStatus)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid document status: ${x}` });
        }
      }
    }),
  division: trimOpt(120),
  subdivision: trimOpt(120),
  team: trimOpt(120),
  productId: trimOpt(64),
  /** Exact `allocation_entity.name`, or the rollup sentinel `Unassigned` (unmapped AR lines only). */
  allocationProductName: trimOpt(500),
  mapped: z.enum(["true", "false"]).optional(),
  warningsOnly: z.enum(["true", "false"]).optional(),
  client: trimOpt(200),
  masterProduct: trimOpt(200),
  contractNumber: trimOpt(120),
  counterpartReference: trimOpt(120),
  signedFrom: isoDate.optional(),
  signedTo: isoDate.optional(),
  importId: trimOpt(64),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});

type Parsed = z.infer<typeof querySchema>;

/** Match AR lines to SAP client revenue: explicit `ar_entry_id` first, else SO + product label (same year). */
function arRevenueMatchLateral(includeInvoiceJson: boolean): Prisma.Sql {
  const matchWhere = Prisma.sql`
  WHERE re.year = ar.year
    AND (
      re.ar_entry_id = ar.id
      OR (
        re.ar_entry_id IS NULL
        AND ar.sap_so_number IS NOT NULL
        AND re.sap_sales_order IS NOT NULL
        AND re.product_label IS NOT NULL
        AND LTRIM(re.sap_sales_order, '0') = LTRIM(ar.sap_so_number, '0')
        AND LOWER(BTRIM(re.product_label)) = LOWER(BTRIM(ar.sf_product_name))
      )
    )`;
  if (includeInvoiceJson) {
    return Prisma.sql`
LEFT JOIN LATERAL (
  SELECT
    COUNT(re.id)::int AS match_count,
    COALESCE(SUM(re.amount_eur::numeric), 0)::numeric AS matched_amount_eur,
    COALESCE(
      json_agg(
        json_build_object(
          'invoiceNr', re.sap_invoice_nr,
          'year', re.year,
          'month', re.month,
          'amountEur', re.amount_eur,
          'eotp', re.eotp_full,
          'productLabel', re.product_label,
          'salesOrder', re.sap_sales_order
        )
        ORDER BY re.year DESC, re.month DESC, re.sap_invoice_nr
      ) FILTER (WHERE re.id IS NOT NULL),
      '[]'::json
    ) AS matched_invoices
  FROM revenue_entry re
  ${matchWhere}
) match_rev ON true`;
  }
  return Prisma.sql`
LEFT JOIN LATERAL (
  SELECT
    COUNT(re.id)::int AS match_count,
    COALESCE(SUM(re.amount_eur::numeric), 0)::numeric AS matched_amount_eur
  FROM revenue_entry re
  ${matchWhere}
) match_rev ON true`;
}

const baseFrom = Prisma.sql`
  FROM ar_entry ar
  LEFT JOIN allocation_entity ae ON ae.id = ar.allocation_entity_id
`;

function buildWhereParts(q: Parsed): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [Prisma.sql`ar.year = ${q.year}`];

  if (q.status?.length) {
    parts.push(Prisma.sql`ar.document_status IN (${Prisma.join(q.status)})`);
  }
  if (q.division) {
    if (q.division === "Unassigned") {
      parts.push(Prisma.sql`COALESCE(ae.division, 'Unassigned') = 'Unassigned'`);
    } else {
      parts.push(Prisma.sql`ae.division = ${q.division}`);
    }
  }
  if (q.subdivision) {
    parts.push(Prisma.sql`ae."subDivision" = ${q.subdivision}`);
  }
  if (q.team) {
    if (q.team === "Unassigned") {
      parts.push(Prisma.sql`COALESCE(ae.team, 'Unassigned') = 'Unassigned'`);
    } else {
      parts.push(Prisma.sql`ae.team = ${q.team}`);
    }
  }
  if (q.productId) {
    parts.push(Prisma.sql`ar.allocation_entity_id = ${q.productId}`);
  }
  if (q.allocationProductName === "Unassigned") {
    parts.push(Prisma.sql`ar.allocation_entity_id IS NULL`);
  } else if (q.allocationProductName) {
    parts.push(Prisma.sql`ae.name = ${q.allocationProductName}`);
  }
  if (q.mapped === "true") {
    parts.push(Prisma.sql`ar.allocation_entity_id IS NOT NULL`);
  }
  if (q.mapped === "false") {
    parts.push(Prisma.sql`ar.allocation_entity_id IS NULL`);
  }
  if (q.warningsOnly === "true") {
    parts.push(Prisma.sql`ar.import_warning IS NOT NULL`);
  }
  if (q.client) {
    parts.push(
      Prisma.sql`POSITION(LOWER(${q.client}) IN LOWER(COALESCE(ar.client_name, ''))) > 0`
    );
  }
  if (q.masterProduct) {
    parts.push(Prisma.sql`(
      POSITION(LOWER(${q.masterProduct}) IN LOWER(COALESCE(ar.sf_master_product_name, ''))) > 0
      OR POSITION(LOWER(${q.masterProduct}) IN LOWER(COALESCE(ar.sf_master_product_key, ''))) > 0
    )`);
  }
  if (q.contractNumber) {
    parts.push(
      Prisma.sql`POSITION(LOWER(${q.contractNumber}) IN LOWER(ar.contract_number)) > 0`
    );
  }
  if (q.counterpartReference) {
    parts.push(Prisma.sql`ar.counterpart_reference = ${q.counterpartReference}`);
  }
  if (q.signedFrom) {
    parts.push(Prisma.sql`ar.signed_date IS NOT NULL AND ar.signed_date >= ${q.signedFrom}::date`);
  }
  if (q.signedTo) {
    parts.push(Prisma.sql`ar.signed_date IS NOT NULL AND ar.signed_date <= ${q.signedTo}::date`);
  }
  if (q.importId) {
    parts.push(Prisma.sql`ar.import_id = ${q.importId}`);
  }

  return parts;
}

function whereSql(q: Parsed): Prisma.Sql {
  const parts = buildWhereParts(q);
  return Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`;
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string") return v.slice(0, 10);
  return null;
}

type LineRow = {
  id: string;
  import_id: string;
  unique_ar_id: string;
  contract_number: string;
  contract_name: string | null;
  counterpart_reference: string | null;
  line_item_number: string;
  document_status: string;
  signed_date: unknown;
  client_name: string | null;
  sf_master_product_name: string | null;
  sf_master_product_key: string | null;
  sf_product_name: string;
  description: string | null;
  sap_product_code: string | null;
  sap_so_number: string | null;
  wbs: string | null;
  end_date: unknown;
  quantity: unknown;
  amount_eur: unknown;
  year: number;
  allocation_entity_id: string | null;
  ae_name: string | null;
  ae_division: string | null;
  ae_sub_division: string | null;
  ae_team: string | null;
  ae_sap_eotp_code: string | null;
  import_warning: string | null;
  match_count: number | null;
  matched_amount_eur: unknown;
  matched_invoices: unknown;
};

function parseMatchedInvoices(raw: unknown): ArMatchedInvoice[] {
  if (raw == null) return [];
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v.map((item: Record<string, unknown>) => ({
    invoiceNr: String(item.invoiceNr ?? ""),
    year: Number(item.year),
    month: Number(item.month),
    amountEur: num(item.amountEur),
    eotp: item.eotp == null ? null : String(item.eotp),
    productLabel: item.productLabel == null ? null : String(item.productLabel),
    salesOrder: item.salesOrder == null ? null : String(item.salesOrder),
  }));
}

function mapLine(r: LineRow): ArReportLine {
  const matchCount = Number(r.match_count ?? 0);
  return {
    id: r.id,
    importId: r.import_id,
    uniqueArId: r.unique_ar_id,
    contractNumber: r.contract_number,
    contractName: r.contract_name,
    counterpartReference: r.counterpart_reference,
    lineItemNumber: r.line_item_number,
    documentStatus: r.document_status,
    signedDate: toIsoDate(r.signed_date),
    clientName: r.client_name,
    sfMasterProductName: r.sf_master_product_name,
    sfMasterProductKey: r.sf_master_product_key,
    sfProductName: r.sf_product_name,
    description: r.description,
    sapProductCode: r.sap_product_code,
    sapSoNumber: r.sap_so_number,
    wbs: r.wbs,
    endDate: toIsoDate(r.end_date),
    quantity: numOrNull(r.quantity),
    amountEur: num(r.amount_eur),
    year: r.year,
    allocationEntityId: r.allocation_entity_id,
    allocationEntityName: r.ae_name,
    division: r.ae_division,
    subDivision: r.ae_sub_division,
    team: r.ae_team,
    sapEotpCode: r.ae_sap_eotp_code,
    importWarning: r.import_warning,
    matchCount,
    matchedAmountEur: num(r.matched_amount_eur),
    matchedInvoices: parseMatchedInvoices(r.matched_invoices),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: searchParams.get("year"),
      status: searchParams.get("status") ?? undefined,
      division: searchParams.get("division") ?? undefined,
      subdivision: searchParams.get("subdivision") ?? undefined,
      team: searchParams.get("team") ?? undefined,
      productId: searchParams.get("productId") ?? undefined,
      allocationProductName: searchParams.get("allocationProductName") ?? undefined,
      mapped: searchParams.get("mapped") ?? undefined,
      warningsOnly: searchParams.get("warningsOnly") ?? undefined,
      client: searchParams.get("client") ?? undefined,
      masterProduct: searchParams.get("masterProduct") ?? undefined,
      contractNumber: searchParams.get("contractNumber") ?? undefined,
      counterpartReference: searchParams.get("counterpartReference") ?? undefined,
      signedFrom: searchParams.get("signedFrom") ?? undefined,
      signedTo: searchParams.get("signedTo") ?? undefined,
      importId: searchParams.get("importId") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      offset: searchParams.get("offset") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid query", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const q = parsed.data;
    const w = whereSql(q);

    const [countRows, aggRows, matchedAggRows, statusRows, clientRows, productRows, lineRows] =
      await Promise.all([
      prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS c ${baseFrom} ${w}`),
      prisma.$queryRaw<
        {
          line_count: bigint;
          total_eur: unknown;
          mapped_count: bigint;
          warning_count: bigint;
        }[]
      >(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS line_count,
          COALESCE(SUM(ar.amount_eur::numeric), 0) AS total_eur,
          SUM(CASE WHEN ar.allocation_entity_id IS NOT NULL THEN 1 ELSE 0 END)::bigint AS mapped_count,
          SUM(CASE WHEN ar.import_warning IS NOT NULL THEN 1 ELSE 0 END)::bigint AS warning_count
        ${baseFrom}
        ${w}
      `),
      prisma.$queryRaw<{ matched_line_count: bigint; matched_total_eur: unknown }[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE COALESCE(match_rev.match_count, 0) > 0)::bigint AS matched_line_count,
          COALESCE(SUM(match_rev.matched_amount_eur::numeric), 0) AS matched_total_eur
        ${baseFrom}
        ${arRevenueMatchLateral(false)}
        ${w}
      `),
      prisma.$queryRaw<{ document_status: string; c: bigint; sum_eur: unknown }[]>(Prisma.sql`
        SELECT ar.document_status, COUNT(*)::bigint AS c, COALESCE(SUM(ar.amount_eur::numeric), 0) AS sum_eur
        ${baseFrom}
        ${w}
        GROUP BY ar.document_status
        ORDER BY sum_eur DESC NULLS LAST
      `),
      prisma.$queryRaw<{ client: string; sum_eur: unknown }[]>(Prisma.sql`
        SELECT COALESCE(ar.client_name, '(blank)') AS client, COALESCE(SUM(ar.amount_eur::numeric), 0) AS sum_eur
        ${baseFrom}
        ${w}
        GROUP BY COALESCE(ar.client_name, '(blank)')
        ORDER BY sum_eur DESC NULLS LAST
        LIMIT 15
      `),
      prisma.$queryRaw<
        { allocation_entity_id: string | null; product_name: string | null; sum_eur: unknown }[]
      >(Prisma.sql`
        SELECT
          ar.allocation_entity_id,
          COALESCE(MAX(ae.name), '(unmapped)') AS product_name,
          COALESCE(SUM(ar.amount_eur::numeric), 0) AS sum_eur
        ${baseFrom}
        ${w}
        GROUP BY ar.allocation_entity_id
        ORDER BY sum_eur DESC NULLS LAST
        LIMIT 15
      `),
      prisma.$queryRaw<LineRow[]>(Prisma.sql`
        SELECT
          ar.id,
          ar.import_id,
          ar.unique_ar_id,
          ar.contract_number,
          ar.contract_name,
          ar.counterpart_reference,
          ar.line_item_number,
          ar.document_status,
          ar.signed_date,
          ar.client_name,
          ar.sf_master_product_name,
          ar.sf_master_product_key,
          ar.sf_product_name,
          ar.description,
          ar.sap_product_code,
          ar.sap_so_number,
          ar.wbs,
          ar.end_date,
          ar.quantity,
          ar.amount_eur,
          ar.year,
          ar.allocation_entity_id,
          ae.name AS ae_name,
          ae.division AS ae_division,
          ae."subDivision" AS ae_sub_division,
          ae.team AS ae_team,
          ae."sapEotpCode" AS ae_sap_eotp_code,
          ar.import_warning,
          match_rev.match_count,
          match_rev.matched_amount_eur,
          match_rev.matched_invoices
        ${baseFrom}
        ${arRevenueMatchLateral(true)}
        ${w}
        ORDER BY ar.contract_number, ar.line_item_number, ar.id
        LIMIT ${q.limit}
        OFFSET ${q.offset}
      `),
    ]);

    const total = Number(countRows[0]?.c ?? 0);
    const agg = aggRows[0];
    const matchedAgg = matchedAggRows[0];
    const lineCount = Number(agg?.line_count ?? 0);
    const summary: ArReportSummary = {
      lineCount,
      totalEur: num(agg?.total_eur),
      mappedCount: Number(agg?.mapped_count ?? 0),
      warningCount: Number(agg?.warning_count ?? 0),
      matchedLineCount: Number(matchedAgg?.matched_line_count ?? 0),
      matchedTotalEur: num(matchedAgg?.matched_total_eur),
      byStatus: statusRows.map((r) => ({
        status: r.document_status,
        count: Number(r.c),
        sumEur: num(r.sum_eur),
      })),
      topClients: clientRows.map((r) => ({
        client: r.client,
        sumEur: num(r.sum_eur),
      })),
      topProducts: productRows.map((r) => ({
        productName: r.product_name ?? "(unmapped)",
        allocationEntityId: r.allocation_entity_id,
        sumEur: num(r.sum_eur),
      })),
    };

    const body: ArReportResponse = {
      meta: {
        year: q.year,
        total,
        limit: q.limit,
        offset: q.offset,
        filters: {
          status: q.status,
          division: q.division,
          subdivision: q.subdivision,
          team: q.team,
          productId: q.productId,
          allocationProductName: q.allocationProductName,
          mapped: q.mapped === "true" ? true : q.mapped === "false" ? false : undefined,
          warningsOnly: q.warningsOnly === "true" ? true : undefined,
          client: q.client,
          masterProduct: q.masterProduct,
          contractNumber: q.contractNumber,
          counterpartReference: q.counterpartReference,
          signedFrom: q.signedFrom,
          signedTo: q.signedTo,
          importId: q.importId,
        },
      },
      summary,
      lines: lineRows.map(mapLine),
    };

    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load AR report" }, { status: 500 });
  }
}
