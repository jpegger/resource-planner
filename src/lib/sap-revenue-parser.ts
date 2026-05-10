export type SapClientInvoiceRow = {
  sapDocType: string;
  sapInvoiceNr: string;
  /** SAP invoice line item (`Poste`, col 48). Multiple per `sapInvoiceNr`. */
  sapInvoiceItem: number;
  sapSalesOrder: string | null;
  extDocRef: string | null;
  clientName: string | null;
  sapArticleCode: string | null;
  productLabel: string | null;
  eotpFull: string | null;
  accountingYear: number;
  invoiceDate: { year: number; month: number; day: number };
  amountEur: string;
};

function splitSemicolonLine(line: string): string[] {
  return line.split(";").map((c) => c.trim().replace(/^"|"$/g, ""));
}

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

/** Excel 1900 date system serial (often exported as plain integer, e.g. `45497`). */
function parseExcelSerialDate(raw: string): { year: number; month: number; day: number } | null {
  const s = raw.trim().replace(/\s/g, "");
  if (!s || /[\/]/.test(s)) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number.parseFloat(s.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const serial = Math.floor(n);
  // ~1900-01-01 … ~2173-10-14; keeps out accidental text IDs in the same column.
  if (serial < 1 || serial > 100_000) return null;

  const MS_PER_DAY = 86_400_000;
  // Days from 1899-12-30 to 1970-01-01 in Excel’s numbering (incl. 1900 leap bug) → align with JS UTC dates.
  const utcDays = Math.floor(serial - 25_569);
  const d = new Date(utcDays * MS_PER_DAY);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (year < 1900 || year > 2200) return null;
  return { year, month, day };
}

/** `Date de la pièce` (col 59): `DD/MM/YYYY` or Excel serial. */
function parseInvoicePieceDate(raw: string): { year: number; month: number; day: number } | null {
  return parseDdMmYyyy(raw) ?? parseExcelSerialDate(raw);
}

/** ZCOMM_REPORT export: semicolon, 68 columns (design §3.6, §7.4). */
export function parseSapClientInvoiceCsv(text: string): {
  rows: SapClientInvoiceRow[];
  totalLines: number;
  skipped: number;
} {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows: [], totalLines: 0, skipped: 0 };

  let start = 0;
  const probe = splitSemicolonLine(lines[0] ?? "");
  if (
    probe.length > 41 &&
    (probe[41]?.toLowerCase().includes("facture") || probe[4]?.toLowerCase().includes("vente"))
  ) {
    start = 1;
  }

  const rows: SapClientInvoiceRow[] = [];
  let skipped = 0;

  for (let i = start; i < lines.length; i++) {
    const parts = splitSemicolonLine(lines[i] ?? "");
    if (parts.length < 60) {
      skipped++;
      continue;
    }

    const sapInvoiceNr = (parts[41] ?? "").trim();
    if (!sapInvoiceNr) {
      skipped++;
      continue;
    }

    const yearRaw = (parts[58] ?? "").trim();
    const accountingYear = Number.parseInt(yearRaw, 10);
    if (!Number.isFinite(accountingYear)) {
      skipped++;
      continue;
    }

    const dateParts = parseInvoicePieceDate(parts[59] ?? "");
    if (!dateParts) {
      skipped++;
      continue;
    }

    const amountRaw = (parts[45] ?? "").trim().replace(/\s/g, "");
    if (!amountRaw) {
      skipped++;
      continue;
    }

    const sapDocType = (parts[0] ?? "").trim().toUpperCase();
    if (!sapDocType) {
      skipped++;
      continue;
    }

    const sapInvoiceItem = Number.parseInt((parts[48] ?? "").trim(), 10);
    if (!Number.isFinite(sapInvoiceItem)) {
      skipped++;
      continue;
    }

    const eotp = (parts[31] ?? "").replace(/[, ]+$/g, "").trim() || null;

    // ZCS = invoice (positive). ZCR = credit note (negate).
    const numeric = amountRaw.replace(/\./g, "").replace(",", ".");
    const signed = sapDocType === "ZCR" && !numeric.startsWith("-") ? `-${numeric}` : numeric;

    rows.push({
      sapDocType,
      sapInvoiceNr,
      sapInvoiceItem,
      sapSalesOrder: (parts[4] ?? "").trim() || null,
      extDocRef: (parts[40] ?? "").trim() || null,
      clientName: (parts[6] ?? "").trim() || null,
      sapArticleCode: (parts[20] ?? "").trim() || null,
      productLabel: (parts[23] ?? "").trim() || null,
      eotpFull: eotp,
      accountingYear,
      invoiceDate: dateParts,
      amountEur: signed,
    });
  }

  return { rows, totalLines: lines.length - start, skipped };
}
