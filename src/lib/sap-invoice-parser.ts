export type SapVimInvoiceRow = {
  sapVimDocId: string;
  sapReservationNr: string | null;
  sapVendorCode: string | null;
  vendorName: string | null;
  eotpFullPath: string;
  invoiceDate: { year: number; month: number; day: number };
  amountEur: string;
  compteBudgetaire: string;
};

const STATUS_OK = "Approbation terminée";
const STATUS_SKIP = "Annulé";
const ACCRUAL_SKIP = "T_GRIR";

function parseDdMmYyyy(raw: string): { year: number; month: number; day: number } | null {
  const s = raw.trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const year = Number.parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

function splitSemicolonLine(line: string): string[] {
  return line.split(";").map((c) => c.trim().replace(/^"|"$/g, ""));
}

/** SAP ZVIM_ANA_DETAIL export: semicolon-separated; use fixed column indices (design §3.4). */
export function parseSapVimInvoiceCsv(text: string): {
  rows: SapVimInvoiceRow[];
  totalLines: number;
  skipped: number;
} {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], totalLines: 0, skipped: 0 };

  let start = 0;
  const firstParts = splitSemicolonLine(lines[0] ?? "");
  if (
    firstParts[0] &&
    !/^\d+$/.test(firstParts[2] ?? "") &&
    (firstParts[0].includes("Descr") || firstParts[0].toLowerCase().includes("descr"))
  ) {
    start = 1;
  }

  const rows: SapVimInvoiceRow[] = [];
  let skipped = 0;

  for (let i = start; i < lines.length; i++) {
    const parts = splitSemicolonLine(lines[i] ?? "");
    if (parts.length < 14) {
      skipped++;
      continue;
    }

    const descr = parts[0] ?? "";
    if (descr === STATUS_SKIP) {
      skipped++;
      continue;
    }
    if (descr !== STATUS_OK) {
      skipped++;
      continue;
    }

    const compte = (parts[9] ?? "").trim();
    if (!compte) {
      skipped++;
      continue;
    }
    if (compte === ACCRUAL_SKIP) {
      skipped++;
      continue;
    }

    const sapVimDocId = (parts[2] ?? "").trim();
    if (!sapVimDocId) {
      skipped++;
      continue;
    }

    let eotp = (parts[13] ?? "").replace(/[, ]+$/g, "").trim();
    if (!eotp) {
      skipped++;
      continue;
    }

    const dateParts = parseDdMmYyyy(parts[10] ?? "");
    if (!dateParts) {
      skipped++;
      continue;
    }

    const amountRaw = (parts[6] ?? "").trim();
    if (!amountRaw) {
      skipped++;
      continue;
    }

    rows.push({
      sapVimDocId,
      sapReservationNr: (parts[3] ?? "").trim() || null,
      sapVendorCode: (parts[4] ?? "").trim() || null,
      vendorName: (parts[5] ?? "").trim() || null,
      eotpFullPath: eotp,
      invoiceDate: dateParts,
      amountEur: amountRaw.replace(/\s/g, ""),
      compteBudgetaire: compte,
    });
  }

  return { rows, totalLines: lines.length - start, skipped };
}
