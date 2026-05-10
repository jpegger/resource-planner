import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import type {
  ArInvoicingReportLine,
  ArInvoicingReportResponse,
  ArInvoicingReportSummary,
  ArInvoicingSapRow,
  ArInvoicingUnmatchedBucket,
} from "@/lib/ar-invoicing-report-types";
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
  year: z.coerce.number().int().min(1990).max(2100).optional(),
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
  limit: z.coerce.number().int().min(1).max(2000).default(300),
  offset: z.coerce.number().int().min(0).default(0),
});

type Parsed = z.infer<typeof querySchema>;

const baseFrom = Prisma.sql`
  FROM ar_entry ar
  LEFT JOIN allocation_entity ae ON ae.id = ar.allocation_entity_id
`;

function buildWhereParts(q: Parsed): Prisma.Sql[] {
  const parts: Prisma.Sql[] = [];
  if (q.year != null) {
    parts.push(Prisma.sql`ar.year = ${q.year}`);
  }

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
  if (parts.length === 0) return Prisma.empty;
  return Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`;
}

/**
 * Match `revenue_entry` to AR by explicit FK (`ar_entry_id`) first, then legacy
 * SO + product label heuristic when `ar_entry_id` is still null (older imports).
 *
 * Year handling:
 * - FK link → no year predicate (the FK is year-agnostic; e.g. AR row in 2025
 *   can carry SAP invoice rows from 2023 if the contract spans years).
 * - Heuristic fallback → still requires `re.year = ar.year` to avoid spurious
 *   matches between unrelated years that happen to share an SO + product label.
 */
function arInvoicingMatchLateral(): Prisma.Sql {
  return Prisma.sql`
LEFT JOIN LATERAL (
  SELECT
    COUNT(re.id)::int AS invoice_row_count,
    COALESCE(SUM(re.amount_eur::numeric), 0)::numeric AS invoiced_total_eur,
    COALESCE(
      json_agg(
        json_build_object(
          'sapDocType', re.sap_doc_type,
          'sapInvoiceNr', re.sap_invoice_nr,
          'sapSalesOrder', re.sap_sales_order,
          'month', re.month,
          'year', re.year,
          'amountEur', re.amount_eur,
          'sapDesignation', re.product_label,
          'sapArticleCode', re.sap_article_code,
          'extDocRef', re.ext_doc_ref,
          'linkSource', CASE WHEN re.ar_entry_id = ar.id THEN 'ar_entry_id' ELSE 'heuristic' END,
          'invoicedProductName', re_ae.name,
          'invoicedProductId', re_ae.id,
          'division', re_ae.division,
          'subDivision', re_ae."subDivision",
          'productFamily', re_ae."productFamily"
        )
        ORDER BY re.year DESC, re.month DESC, re.sap_invoice_nr, re.id
      ) FILTER (WHERE re.id IS NOT NULL),
      '[]'::json
    ) AS invoices_json
  FROM revenue_entry re
  LEFT JOIN allocation_entity re_ae ON re_ae.id = re.allocation_entity_id
  WHERE
    re.ar_entry_id = ar.id
    OR (
      re.ar_entry_id IS NULL
      AND re.year = ar.year
      AND ar.sap_so_number IS NOT NULL
      AND re.sap_sales_order IS NOT NULL
      AND re.product_label IS NOT NULL
      AND LTRIM(re.sap_sales_order, '0') = LTRIM(ar.sap_so_number, '0')
      AND LOWER(BTRIM(re.product_label)) = LOWER(BTRIM(ar.sf_product_name))
    )
) inv ON true`;
}

function arInvoicingMatchLateralAggOnly(): Prisma.Sql {
  return Prisma.sql`
LEFT JOIN LATERAL (
  SELECT
    COUNT(re.id)::int AS invoice_row_count,
    COALESCE(SUM(re.amount_eur::numeric), 0)::numeric AS invoiced_total_eur
  FROM revenue_entry re
  WHERE
    re.ar_entry_id = ar.id
    OR (
      re.ar_entry_id IS NULL
      AND re.year = ar.year
      AND ar.sap_so_number IS NOT NULL
      AND re.sap_sales_order IS NOT NULL
      AND re.product_label IS NOT NULL
      AND LTRIM(re.sap_sales_order, '0') = LTRIM(ar.sap_so_number, '0')
      AND LOWER(BTRIM(re.product_label)) = LOWER(BTRIM(ar.sf_product_name))
    )
) inv ON true`;
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

function coerceLinkSource(v: unknown): ArInvoicingSapRow["linkSource"] {
  if (v === "heuristic") return "heuristic";
  if (v === "unmatched") return "unmatched";
  return "ar_entry_id";
}

function parseInvoices(raw: unknown): ArInvoicingSapRow[] {
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
    sapDocType: String(item.sapDocType ?? ""),
    sapInvoiceNr: String(item.sapInvoiceNr ?? ""),
    sapSalesOrder: item.sapSalesOrder == null ? null : String(item.sapSalesOrder),
    month: Number(item.month),
    year: Number(item.year),
    amountEur: num(item.amountEur),
    sapDesignation: item.sapDesignation == null ? null : String(item.sapDesignation),
    sapArticleCode: item.sapArticleCode == null ? null : String(item.sapArticleCode),
    extDocRef: item.extDocRef == null ? null : String(item.extDocRef),
    linkSource: coerceLinkSource(item.linkSource),
    invoicedProductName: item.invoicedProductName == null ? null : String(item.invoicedProductName),
    invoicedProductId: item.invoicedProductId == null ? null : String(item.invoicedProductId),
    division: item.division == null ? null : String(item.division),
    subDivision: item.subDivision == null ? null : String(item.subDivision),
    productFamily: item.productFamily == null ? null : String(item.productFamily),
  }));
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
  sf_product_name: string;
  description: string | null;
  sap_so_number: string | null;
  quantity: unknown;
  amount_eur: unknown;
  year: number;
  allocation_entity_id: string | null;
  ae_name: string | null;
  ae_division: string | null;
  ae_sub_division: string | null;
  ae_product_family: string | null;
  import_warning: string | null;
  invoice_row_count: number | null;
  invoiced_total_eur: unknown;
  invoices_json: unknown;
};

function mapLine(r: LineRow): ArInvoicingReportLine {
  const invoices = parseInvoices(r.invoices_json);
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
    sfProductName: r.sf_product_name,
    description: r.description,
    sapSoNumber: r.sap_so_number,
    quantity: numOrNull(r.quantity),
    amountEur: num(r.amount_eur),
    year: r.year,
    allocationEntityId: r.allocation_entity_id,
    allocationEntityName: r.ae_name,
    arDivision: r.ae_division,
    arSubDivision: r.ae_sub_division,
    arProductFamily: r.ae_product_family,
    importWarning: r.import_warning,
    invoices,
    invoicedTotalEur: num(r.invoiced_total_eur),
    invoiceRowCount: Number(r.invoice_row_count ?? 0),
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse({
      year: searchParams.get("year") ?? undefined,
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

    const [countRows, aggRows, lineRows] = await Promise.all([
      prisma.$queryRaw<{ c: bigint }[]>(Prisma.sql`SELECT COUNT(*)::bigint AS c ${baseFrom} ${w}`),
      prisma.$queryRaw<
        {
          line_count: bigint;
          total_ar_eur: unknown;
          lines_with_invoicing: bigint;
          lines_without_invoicing: bigint;
          total_invoiced_eur: unknown;
        }[]
      >(Prisma.sql`
        SELECT
          COUNT(*)::bigint AS line_count,
          COALESCE(SUM(ar.amount_eur::numeric), 0) AS total_ar_eur,
          SUM(CASE WHEN COALESCE(inv.invoice_row_count, 0) > 0 THEN 1 ELSE 0 END)::bigint AS lines_with_invoicing,
          SUM(CASE WHEN COALESCE(inv.invoice_row_count, 0) = 0 THEN 1 ELSE 0 END)::bigint AS lines_without_invoicing,
          COALESCE(SUM(inv.invoiced_total_eur::numeric), 0) AS total_invoiced_eur
        ${baseFrom}
        ${arInvoicingMatchLateralAggOnly()}
        ${w}
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
          ar.sf_product_name,
          ar.description,
          ar.sap_so_number,
          ar.quantity,
          ar.amount_eur,
          ar.year,
          ar.allocation_entity_id,
          ae.name AS ae_name,
          ae.division AS ae_division,
          ae."subDivision" AS ae_sub_division,
          ae."productFamily" AS ae_product_family,
          ar.import_warning,
          inv.invoice_row_count,
          inv.invoiced_total_eur,
          inv.invoices_json
        ${baseFrom}
        ${arInvoicingMatchLateral()}
        ${w}
        ORDER BY
          (ar.counterpart_reference IS NULL),
          ar.counterpart_reference,
          ar.contract_number,
          ar.line_item_number,
          ar.id
        LIMIT ${q.limit}
        OFFSET ${q.offset}
      `),
    ]);

    const total = Number(countRows[0]?.c ?? 0);
    const agg = aggRows[0];
    const summary: ArInvoicingReportSummary = {
      lineCount: Number(agg?.line_count ?? 0),
      totalArEur: num(agg?.total_ar_eur),
      linesWithInvoicing: Number(agg?.lines_with_invoicing ?? 0),
      linesWithoutInvoicing: Number(agg?.lines_without_invoicing ?? 0),
      totalInvoicedEur: num(agg?.total_invoiced_eur),
    };

    const distinctRefs = [
      ...new Set(
        lineRows
          .map((r) => r.counterpart_reference)
          .filter((s): s is string => typeof s === "string" && s.length > 0)
      ),
    ];

    const unmatched: ArInvoicingUnmatchedBucket[] = [];
    if (distinctRefs.length > 0) {
      const yearPredicate =
        q.year != null ? Prisma.sql`AND re.year = ${q.year}` : Prisma.empty;
      type UnmatchedRow = {
        counterpart_reference: string;
        allocation_entity_id: string | null;
        allocation_entity_name: string | null;
        allocation_entity_division: string | null;
        allocation_entity_sub_division: string | null;
        allocation_entity_product_family: string | null;
        row_count: number;
        invoiced_total_eur: unknown;
        invoices_json: unknown;
      };
      const unmatchedRows = await prisma.$queryRaw<UnmatchedRow[]>(Prisma.sql`
        SELECT
          re.ext_doc_ref AS counterpart_reference,
          re_ae.id  AS allocation_entity_id,
          re_ae.name AS allocation_entity_name,
          re_ae.division AS allocation_entity_division,
          re_ae."subDivision" AS allocation_entity_sub_division,
          re_ae."productFamily" AS allocation_entity_product_family,
          COUNT(re.id)::int AS row_count,
          COALESCE(SUM(re.amount_eur::numeric), 0)::numeric AS invoiced_total_eur,
          COALESCE(
            json_agg(
              json_build_object(
                'sapDocType', re.sap_doc_type,
                'sapInvoiceNr', re.sap_invoice_nr,
                'sapSalesOrder', re.sap_sales_order,
                'month', re.month,
                'year', re.year,
                'amountEur', re.amount_eur,
                'sapDesignation', re.product_label,
                'sapArticleCode', re.sap_article_code,
                'extDocRef', re.ext_doc_ref,
                'linkSource', 'unmatched',
                'invoicedProductName', re_ae.name,
                'invoicedProductId', re_ae.id,
                'division', re_ae.division,
                'subDivision', re_ae."subDivision",
                'productFamily', re_ae."productFamily"
              )
              ORDER BY re.year DESC, re.month DESC, re.sap_invoice_nr, re.id
            ) FILTER (WHERE re.id IS NOT NULL),
            '[]'::json
          ) AS invoices_json
        FROM revenue_entry re
        LEFT JOIN allocation_entity re_ae ON re_ae.id = re.allocation_entity_id
        WHERE re.ext_doc_ref IN (${Prisma.join(distinctRefs)})
          ${yearPredicate}
          AND re.ar_entry_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM ar_entry ar2
            WHERE ar2.counterpart_reference = re.ext_doc_ref
              AND ar2.year = re.year
              AND ar2.sap_so_number IS NOT NULL
              AND re.sap_sales_order IS NOT NULL
              AND re.product_label IS NOT NULL
              AND LTRIM(re.sap_sales_order, '0') = LTRIM(ar2.sap_so_number, '0')
              AND LOWER(BTRIM(re.product_label)) = LOWER(BTRIM(ar2.sf_product_name))
          )
        GROUP BY
          re.ext_doc_ref,
          re_ae.id, re_ae.name, re_ae.division, re_ae."subDivision", re_ae."productFamily"
        ORDER BY re.ext_doc_ref, re_ae.name NULLS LAST
      `);
      for (const u of unmatchedRows) {
        unmatched.push({
          counterpartReference: u.counterpart_reference,
          allocationEntityId: u.allocation_entity_id,
          allocationEntityName: u.allocation_entity_name,
          allocationEntityDivision: u.allocation_entity_division,
          allocationEntitySubDivision: u.allocation_entity_sub_division,
          allocationEntityProductFamily: u.allocation_entity_product_family,
          rowCount: Number(u.row_count ?? 0),
          invoicedTotalEur: num(u.invoiced_total_eur),
          invoices: parseInvoices(u.invoices_json),
        });
      }
    }

    const yearRows = await prisma.$queryRaw<{ year: number }[]>(Prisma.sql`
      SELECT DISTINCT year FROM (
        SELECT year FROM ar_entry
        UNION ALL
        SELECT year FROM revenue_entry
      ) y
      WHERE year IS NOT NULL
      ORDER BY year ASC
    `);
    const availableYears = yearRows.map((r) => Number(r.year)).filter((n) => Number.isFinite(n));

    const body: ArInvoicingReportResponse = {
      meta: {
        year: q.year ?? null,
        total,
        limit: q.limit,
        offset: q.offset,
        availableYears,
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
      unmatched,
    };

    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to load AR invoicing report" }, { status: 500 });
  }
}
