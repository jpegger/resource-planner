import * as XLSX from "xlsx";

export type BaselineRow = {
  eotp: string;
  eopLabel: string;
  cellule: string;
  amount: number;
};

export type ParseResult = {
  rows: BaselineRow[];
  warnings: string[];
};

export function parseBaselineExcel(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return { rows: [], warnings: ["File appears empty or could not be parsed"] };
  }
  const sheet = workbook.Sheets[sheetName];

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  });

  if (raw.length === 0) {
    return { rows: [], warnings: ["File appears empty or could not be parsed"] };
  }

  const headers = Object.keys(raw[0] ?? {});
  const amountCol = headers.find((h) => h.trim().startsWith("Budget"));
  if (!amountCol) {
    return {
      rows: [],
      warnings: ['Could not find a column starting with "Budget" — check the file format'],
    };
  }

  const rows: BaselineRow[] = [];
  const warnings: string[] = [];

  for (const row of raw) {
    const eotp = String(row["Prog Fin"] ?? "").trim();
    const eopLabel = String(row["Prog Fin lib"] ?? "").trim();
    const cellule = String(row["Cellule"] ?? "").trim();
    const rawAmt = Number(row[amountCol]);

    if (!eotp || Number.isNaN(rawAmt)) continue;

    if (/[a-wyzA-WYZ]/.test(eotp) || eotp.includes("XX") || eotp.includes("xx")) {
      warnings.push(
        `Non-standard EOTP code: "${eotp}" (${eopLabel}) — will import but may not match routing`
      );
    }

    rows.push({
      eotp,
      eopLabel,
      cellule,
      amount: Math.abs(rawAmt),
    });
  }

  return { rows, warnings };
}
