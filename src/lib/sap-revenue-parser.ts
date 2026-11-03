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

/** Normalize CSV header for matching (diacritics stripped, lowercased). */
function normalizeSapHeaderLabel(raw: string): string {
  return raw
    .trim()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

/** SAP activity sector **12** = bodyshopping — col 40 external sales doc ref is often empty; AR link uses `Référence client`. */
const ACTIVITY_SECTOR_BODYSHOPPING = "12";

function findActivitySectorColumnIndex(headerParts: string[]): number | null {
  for (let i = 0; i < headerParts.length; i++) {
    const n = normalizeSapHeaderLabel(headerParts[i] ?? "");
    if (!n) continue;
    const hasSecteur = n.includes("secteur");
    const hasActivite = n.includes("activit");
    const activitySectorEn = n.includes("activity") && n.includes("sector");
    if ((hasSecteur && hasActivite) || activitySectorEn) return i;
  }
  return null;
}

/**
 * Column whose header is specifically **Référence client** (not generic “counterpart” labels).
 * Used when `Secteurs d'activité` = 12 to populate `ext_doc_ref` for AR matching.
 */
function findReferenceClientColumnIndex(headerParts: string[]): number | null {
  let bestIdx: number | null = null;
  let bestScore = 0;
  for (let i = 0; i < headerParts.length; i++) {
    const n = normalizeSapHeaderLabel(headerParts[i] ?? "");
    if (!n || !n.includes("reference") || !n.includes("client")) continue;
    let score = 2;
    if (n === "reference client") score = 5;
    else if (n.startsWith("reference client") && n.length < 48) score = 4;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * ZCOMM header row: find the column that carries the customer / counterpart reference
 * (often "Référence client") when col 40 "Numéro externe de document de vente" is empty.
 */
function findClientReferenceColumnIndex(headerParts: string[]): number | null {
  let bestIdx: number | null = null;
  let bestScore = 0;
  for (let i = 0; i < headerParts.length; i++) {
    const n = normalizeSapHeaderLabel(headerParts[i] ?? "");
    if (!n) continue;
    const hasReferenceWord = n.includes("reference");
    const looksLikeRefAbbrev =
      /\bref\b/.test(n) || n.includes("ref.") || n.includes("ref ");
    if (!hasReferenceWord && !looksLikeRefAbbrev) continue;

    let score = 1;
    if (n.includes("client")) score = 3;
    else if (n.includes("contrepartie") || n.includes("counterpart")) score = 2;
    else if (hasReferenceWord) score = 2;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Salesforce AR-style counterpart reference (subset — fast filter before DB match). */
const AR_COUNTERPART_PATTERN = /^AR-\d+/i;

/**
 * Primary: col 40 (Numéro externe de document de vente).
 * **Bodyshopping (secteurs d'activité = 12):** col 40 is usually empty — use **Référence client**
 * first for AR `counterpart_reference` matching, then col 40, then generic client-ref / scan.
 */
function resolveExtDocRef(
  parts: string[],
  clientRefCol: number | null,
  activitySectorCol: number | null,
  referenceClientCol: number | null
): string | null {
  const sectorRaw =
    activitySectorCol != null ? (parts[activitySectorCol] ?? "").trim() : "";
  const bodyshopping = sectorRaw === ACTIVITY_SECTOR_BODYSHOPPING;

  const from40 = (parts[40] ?? "").trim();
  const fromRefClientCol =
    referenceClientCol != null ? (parts[referenceClientCol] ?? "").trim() : "";

  if (bodyshopping) {
    if (fromRefClientCol) return fromRefClientCol;
    if (from40) return from40;
    if (clientRefCol != null) {
      const fromGenericClient = (parts[clientRefCol] ?? "").trim();
      if (fromGenericClient) return fromGenericClient;
    }
    for (const idx of [39, 38, 37, 36, 35, 34, 33]) {
      const t = (parts[idx] ?? "").trim();
      if (t && AR_COUNTERPART_PATTERN.test(t)) return t;
    }
    return null;
  }

  if (from40) return from40;

  if (clientRefCol != null) {
    const fromClient = (parts[clientRefCol] ?? "").trim();
    if (fromClient) return fromClient;
  }

  for (const idx of [39, 38, 37, 36, 35, 34, 33]) {
    const t = (parts[idx] ?? "").trim();
    if (t && AR_COUNTERPART_PATTERN.test(t)) return t;
  }
  return null;
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
  let clientRefCol: number | null = null;
  let activitySectorCol: number | null = null;
  let referenceClientCol: number | null = null;
  const probe = splitSemicolonLine(lines[0] ?? "");
  if (
    probe.length > 41 &&
    (probe[41]?.toLowerCase().includes("facture") || probe[4]?.toLowerCase().includes("vente"))
  ) {
    start = 1;
    clientRefCol = findClientReferenceColumnIndex(probe);
    activitySectorCol = findActivitySectorColumnIndex(probe);
    referenceClientCol = findReferenceClientColumnIndex(probe);
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
      extDocRef: resolveExtDocRef(parts, clientRefCol, activitySectorCol, referenceClientCol),
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
