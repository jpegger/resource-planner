import ExcelJS from "exceljs";

import type { ArReportLine, ArReportSummary } from "@/lib/ar-report-types";

const TABLE_NAME = "ArLines";

/** `dd.MM.yyyy` in local time (export instant). */
function formatExportCalendarDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const y = d.getFullYear();
  return `${day}.${month}.${y}`;
}

export type ArReportExportMeta = {
  year: number;
  filtersLabel: string;
};

function buildExportFilename(meta: ArReportExportMeta, exportedAt: Date): string {
  return `Salesforce_AR_Report_${meta.year}_${formatExportCalendarDate(exportedAt)}.xlsx`;
}

const COLS = [
  "ContractNumber",
  "LineItem",
  "UniqueArId",
  "Status",
  "SignedDate",
  "Client",
  "SfMasterProduct",
  "SfProduct",
  "AmountEur",
  "Year",
  "ProductId",
  "ProductName",
  "Division",
  "Subdivision",
  "Team",
  "SapEotp",
  "InvoiceMatchCount",
  "MatchedRealizedEur",
  "CounterpartRef",
  "ImportId",
  "Warning",
] as const;

const EUR_COL_INDEX = 8;
const MATCHED_EUR_COL_INDEX = 17;

export async function exportArReportToXlsx(
  lines: ArReportLine[],
  summary: ArReportSummary,
  meta: ArReportExportMeta,
  exportedAt: Date = new Date()
): Promise<void> {
  const metaLines: [string, string][] = [
    ["Report", "Salesforce AR (planned revenue)"],
    ["Year", String(meta.year)],
    ["Filters", meta.filtersLabel || "—"],
    ["Lines (export)", String(lines.length)],
    ["Total EUR (filtered)", String(Math.round(summary.totalEur))],
    ["Mapped lines", String(summary.mappedCount)],
    ["Warning lines", String(summary.warningCount)],
    ["Lines with SAP invoice match", String(summary.matchedLineCount)],
    ["Matched realized EUR (filtered)", String(Math.round(summary.matchedTotalEur))],
  ];

  const body: (string | number)[][] = lines.map((r) => [
    r.contractNumber,
    r.lineItemNumber,
    r.uniqueArId,
    r.documentStatus,
    r.signedDate ?? "",
    r.clientName ?? "",
    r.sfMasterProductName ?? r.sfMasterProductKey ?? "",
    r.sfProductName,
    Math.round(r.amountEur),
    r.year,
    r.allocationEntityId ?? "",
    r.allocationEntityName ?? "",
    r.division ?? "",
    r.subDivision ?? "",
    r.team ?? "",
    r.sapEotpCode ?? "",
    r.matchCount,
    Math.round(r.matchedAmountEur),
    r.counterpartReference ?? "",
    r.importId,
    r.importWarning ?? "",
  ]);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("AR lines", {
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

  ws.addTable({
    name: TABLE_NAME,
    displayName: TABLE_NAME,
    ref: `A${tableTopRow}:U${tableTopRow + 1 + body.length}`,
    headerRow: true,
    totalsRow: true,
    style: {
      theme: "TableStyleMedium2",
      showRowStripes: true,
    },
    columns: COLS.map((name, i) => ({
      name,
      filterButton: true,
      totalsRowFunction:
        i === EUR_COL_INDEX || i === MATCHED_EUR_COL_INDEX ? ("sum" as const) : ("none" as const),
      ...(i === 0 ? { totalsRowLabel: "Total" as const } : {}),
    })),
    rows: body,
  });

  const headerRow = tableTopRow;
  const firstDataRow = headerRow + 1;
  const lastRow = headerRow + body.length + 1;

  for (let r = firstDataRow; r <= lastRow; r++) {
    for (const colIdx of [EUR_COL_INDEX, MATCHED_EUR_COL_INDEX]) {
      const cell = ws.getRow(r).getCell(colIdx + 1);
      const v = cell.value;
      if (typeof v === "number") cell.numFmt = "#,##0";
    }
  }

  ws.columns = [
    { width: 14 },
    { width: 12 },
    { width: 22 },
    { width: 12 },
    { width: 12 },
    { width: 28 },
    { width: 28 },
    { width: 36 },
    { width: 14 },
    { width: 8 },
    { width: 14 },
    { width: 28 },
    { width: 10 },
    { width: 18 },
    { width: 18 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 40 },
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
