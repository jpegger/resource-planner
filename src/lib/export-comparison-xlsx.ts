import ExcelJS from "exceljs";

import type { ComparisonRow } from "@/app/reports/comparison/ComparisonTable";

const TABLE_NAME = "ComparisonData";

/** Excel `0%` uses a 0–1 fraction; display is rounded to whole percent. */
function coverageRatioForCell(r: ComparisonRow): number | null {
  const b = r.baselineAmount ?? 0;
  const c = r.snapCashOut ?? 0;
  if (!Number.isFinite(b) || !Number.isFinite(c) || b <= 0) return null;
  return c / b;
}

function roundEur(n: number): number {
  return Math.round(Number(n));
}

export type ComparisonExportMeta = {
  year: number;
  planningSource: string;
  baseline: string;
  division: string;
  subdivision: string;
  team: string;
  owner: string;
};

/** Column names must be Excel structured-reference safe (no spaces). */
const COLS = [
  "Subdivision",
  "Team",
  "EOTP",
  "Label",
  "Internal",
  "External",
  "Direct",
  "CashOut",
  "Baseline",
  "Coverage",
  "Gap",
] as const;

const EUR_COL_INDEXES = new Set([4, 5, 6, 7, 8, 10]);
const PCT_COL_INDEX = 9;

/** `dd.MM.yyyy` in local time (export instant). */
function formatExportCalendarDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${day}.${month}.${y}`;
}

/** e.g. `Baseline-Planning_Comparison_2026_02.05.2026.xlsx` */
function buildExportFilename(meta: ComparisonExportMeta, exportedAt: Date): string {
  return `Baseline-Planning_Comparison_${meta.year}_${formatExportCalendarDate(exportedAt)}.xlsx`;
}

export async function exportComparisonTableToXlsx(
  rows: ComparisonRow[],
  meta: ComparisonExportMeta,
  exportedAt: Date = new Date()
): Promise<void> {
  const filterLabel = (v: string) => (v.trim() ? v : "All");

  const metaLines: [string, string][] = [
    ["Report", "Planning vs baseline comparison"],
    ["Year", String(meta.year)],
    ["Planning source", meta.planningSource],
    ["Baseline", meta.baseline],
    ["Division", filterLabel(meta.division)],
    ["Subdivision", filterLabel(meta.subdivision)],
    ["Team", filterLabel(meta.team)],
    ["Owner", filterLabel(meta.owner)],
  ];

  const body: (string | number)[][] = rows.map((r) => {
    const cov = coverageRatioForCell(r);
    return [
      r.subdivision ?? "",
      r.team ?? "",
      r.eotp,
      r.label,
      roundEur(r.snapInternal),
      roundEur(r.snapExternal),
      roundEur(r.snapDirect),
      roundEur(r.snapCashOut),
      roundEur(r.baselineAmount),
      cov != null ? cov : "",
      roundEur(r.gap),
    ];
  });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Comparison", {
    views: [{ state: "frozen", ySplit: metaLines.length + 1, activeCell: "A1", showGridLines: true }],
  });

  let excelRow = 1;
  for (const [k, v] of metaLines) {
    ws.getCell(excelRow, 1).value = k;
    ws.getCell(excelRow, 2).value = v;
    excelRow++;
  }
  excelRow++;

  const tableTopRow = excelRow;

  const coverageTotalsFormula = `IF(SUBTOTAL(109,${TABLE_NAME}[Baseline])<>0,SUBTOTAL(109,${TABLE_NAME}[CashOut])/SUBTOTAL(109,${TABLE_NAME}[Baseline]),"")`;

  ws.addTable({
    name: TABLE_NAME,
    displayName: TABLE_NAME,
    ref: `A${tableTopRow}:K${tableTopRow + 1 + body.length}`,
    headerRow: true,
    totalsRow: true,
    style: {
      theme: "TableStyleMedium2",
      showRowStripes: true,
    },
    columns: [
      { name: COLS[0], filterButton: true, totalsRowLabel: "Total" },
      { name: COLS[1], filterButton: true, totalsRowFunction: "none" },
      { name: COLS[2], filterButton: true, totalsRowFunction: "none" },
      { name: COLS[3], filterButton: true, totalsRowFunction: "none" },
      { name: COLS[4], filterButton: true, totalsRowFunction: "sum" },
      { name: COLS[5], filterButton: true, totalsRowFunction: "sum" },
      { name: COLS[6], filterButton: true, totalsRowFunction: "sum" },
      { name: COLS[7], filterButton: true, totalsRowFunction: "sum" },
      { name: COLS[8], filterButton: true, totalsRowFunction: "sum" },
      {
        name: COLS[9],
        filterButton: true,
        totalsRowFunction: "custom",
        totalsRowFormula: coverageTotalsFormula,
      },
      { name: COLS[10], filterButton: true, totalsRowFunction: "sum" },
    ],
    rows: body,
  });

  const headerRow = tableTopRow;
  const firstDataRow = headerRow + 1;
  const lastRow = headerRow + body.length + 1;

  for (let r = firstDataRow; r <= lastRow; r++) {
    for (let c = 1; c <= 11; c++) {
      const col0 = c - 1;
      const cell = ws.getRow(r).getCell(c);
      const v = cell.value;
      if (v === null || v === undefined || v === "") continue;

      const isFormula = typeof v === "object" && v !== null && "formula" in v;
      if (EUR_COL_INDEXES.has(col0) && (typeof v === "number" || isFormula)) {
        cell.numFmt = "#,##0";
      } else if (col0 === PCT_COL_INDEX && (typeof v === "number" || isFormula)) {
        cell.numFmt = "0%";
      }
    }
  }

  ws.columns = [
    { width: 18 },
    { width: 18 },
    { width: 14 },
    { width: 36 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
  ];

  const filename = buildExportFilename(meta, exportedAt);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
