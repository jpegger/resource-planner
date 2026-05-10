// Finance DataExport AR file: SalesForce_AR_export_Corrected.csv (semicolon CSV, §3.5).

export type ArLineItem = {
  uniqueArId: string;
  contractNumber: string;
  contractName: string | null;
  counterpartReference: string | null;
  lineItemNumber: string;
  documentStatus: string;
  signedDate: { year: number; month: number; day: number } | null;
  clientName: string | null;
  sfMasterProductName: string | null;
  sfMasterProductKey: string | null;
  sfProductName: string;
  description: string | null;
  sapProductCode: string | null;
  sapSoNumber: string | null;
  wbs: string | null;
  endDate: { year: number; month: number; day: number } | null;
  quantity: string | null;
  amountEur: string;
};

/** Import these AR line document statuses; skip e.g. Draft, Cancelled. */
export const AR_DOCUMENT_STATUSES = ["Signed", "Approved", "Submitted", "Presented"] as const;
export type ArDocumentStatus = (typeof AR_DOCUMENT_STATUSES)[number];
const DOC_OK = new Set<string>(AR_DOCUMENT_STATUSES);

const HDR_PRODUCT_KEY = "Price Book Entry: Product: Master Product: Product Key";

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

function stripOuterQuoteLine(line: string): string {
  const t = line.trim();
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    return t.slice(1, -1);
  }
  return t;
}

function stripInnerQuotes(field: string): string {
  return field.replace(/^"|"$/g, "").trim();
}

/** Semicolon CSV with optional outer quotes per line (design §7.3). */
export function parseSfArExportCsv(csvText: string, importYear: number): {
  rows: ArLineItem[];
  totalInputRows: number;
  skipped: number;
  hasMasterProductKeyColumn: boolean;
} {
  const cleaned = csvText.replace(/^\uFEFF/, "");
  const rawLines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (rawLines.length === 0) {
    return { rows: [], totalInputRows: 0, skipped: 0, hasMasterProductKeyColumn: false };
  }

  const headerLine = stripOuterQuoteLine(rawLines[0] ?? "");
  const headerFields = headerLine.split(";").map(stripInnerQuotes);
  const hasMasterProductKeyColumn = headerFields.includes(HDR_PRODUCT_KEY);

  const col = (name: string, fallbackIndex: number): number => {
    const idx = headerFields.findIndex((h) => h.trim() === name);
    return idx >= 0 ? idx : fallbackIndex;
  };

  const c = {
    accountName: col("Account Name", 0),
    contractNumber: col("Contract Number", 1),
    contractName: col("Contract Name", 2),
    docStatus: col("Document Status", 5),
    signedDate: col("Signed Date", 6),
    counterpart: col("Counterpart reference", 7),
    lineItemNr: col("Line Item Number", 8),
    uniqueArId: col("Unique AR ID", 9),
    masterProductName: col("Price Book Entry: Product: Master Product: Product Name", 10),
    productName: col("Product Name", 11),
    description: col("Description", 12),
    quantity: col("Quantity", 13),
    salesPrice: col("Sales Price", 14),
    totalPrice: col("Total Price", 15),
    wbs: col("WBS", 16),
    sapProduct: col("SAP Product Code", 17),
    sapSo: col("SAP SO Number", 18),
    endDate: col("End Date", 19),
    masterProductKey: hasMasterProductKeyColumn
      ? headerFields.indexOf(HDR_PRODUCT_KEY)
      : -1,
  };

  let skipped = 0;
  const rows: ArLineItem[] = [];

  for (let i = 1; i < rawLines.length; i++) {
    const line = stripOuterQuoteLine(rawLines[i] ?? "");
    const parts = line.split(";").map(stripInnerQuotes);
    const status = (parts[c.docStatus] ?? "").trim();
    if (!DOC_OK.has(status)) {
      skipped++;
      continue;
    }

    const uniqueArId = (parts[c.uniqueArId] ?? "").trim();
    const contractNumber = (parts[c.contractNumber] ?? "").trim();
    const lineItemNumber = (parts[c.lineItemNr] ?? "").trim();
    const sfProductName = (parts[c.productName] ?? "").trim();
    const totalPrice = (parts[c.totalPrice] ?? "").trim();

    if (!uniqueArId || !contractNumber || !lineItemNumber || !sfProductName || !totalPrice) {
      skipped++;
      continue;
    }

    const signedRaw = (parts[c.signedDate] ?? "").trim();
    const signedDate = signedRaw ? parseDdMmYyyy(signedRaw) : null;

    const endRaw = (parts[c.endDate] ?? "").trim();
    const endDate = endRaw ? parseDdMmYyyy(endRaw) : null;

    const masterNameRaw = (parts[c.masterProductName] ?? "").trim();
    const masterKeyRaw =
      c.masterProductKey >= 0 ? (parts[c.masterProductKey] ?? "").trim() : "";

    rows.push({
      uniqueArId,
      contractNumber,
      contractName: (parts[c.contractName] ?? "").trim() || null,
      counterpartReference: (parts[c.counterpart] ?? "").trim() || null,
      lineItemNumber,
      documentStatus: status,
      signedDate,
      clientName: (parts[c.accountName] ?? "").trim() || null,
      sfMasterProductName: masterNameRaw || null,
      sfMasterProductKey: masterKeyRaw || null,
      sfProductName,
      description: (parts[c.description] ?? "").trim() || null,
      sapProductCode: (parts[c.sapProduct] ?? "").trim() || null,
      sapSoNumber: (parts[c.sapSo] ?? "").trim() || null,
      wbs: (parts[c.wbs] ?? "").trim() || null,
      endDate,
      quantity: (parts[c.quantity] ?? "").trim() || null,
      amountEur: totalPrice.replace(/\s/g, ""),
    });
  }

  void importYear;
  return {
    rows,
    totalInputRows: rawLines.length - 1,
    skipped,
    hasMasterProductKeyColumn,
  };
}

/** Normalise API line objects into `ArLineItem[]` when SF sync returns flattened line payloads. */
export function parseSfArFromApiRecords(
  records: Record<string, unknown>[],
  importYear: number
): { rows: ArLineItem[]; totalInputRows: number; skipped: number; hasMasterProductKeyColumn: boolean } {
  const rows: ArLineItem[] = [];
  let skipped = 0;
  let hasKey = false;
  for (const rec of records) {
    const status = String(rec["Document_Status__c"] ?? rec["document_status"] ?? "").trim();
    if (!DOC_OK.has(status)) {
      skipped++;
      continue;
    }
    const key = String(rec["sf_master_product_key"] ?? rec["Master_Product_Key__c"] ?? "").trim();
    if (key) hasKey = true;
    const uniqueArId = String(rec["Unique_AR_ID__c"] ?? rec["unique_ar_id"] ?? "").trim();
    if (!uniqueArId) {
      skipped++;
      continue;
    }
    rows.push({
      uniqueArId,
      contractNumber: String(rec["Name"] ?? rec["contract_number"] ?? "").trim(),
      contractName: rec["Contract_Name__c"] ? String(rec["Contract_Name__c"]) : null,
      counterpartReference: rec["Counterpart_Reference__c"]
        ? String(rec["Counterpart_Reference__c"])
        : null,
      lineItemNumber: String(rec["Line_Item_Number__c"] ?? "").trim(),
      documentStatus: status,
      signedDate: null,
      clientName: rec["Account"] && typeof rec["Account"] === "object" && rec["Account"] !== null
        ? String((rec["Account"] as { Name?: string }).Name ?? "")
        : null,
      sfMasterProductName: rec["master_product_name"] ? String(rec["master_product_name"]) : null,
      sfMasterProductKey: key || null,
      sfProductName: String(rec["Product_Name__c"] ?? rec["sf_product_name"] ?? "").trim() || "—",
      description: rec["Description"] ? String(rec["Description"]) : null,
      sapProductCode: rec["SAP_Product_Code__c"] ? String(rec["SAP_Product_Code__c"]) : null,
      sapSoNumber: rec["SAP_SO_Number__c"] ? String(rec["SAP_SO_Number__c"]) : null,
      wbs: rec["WBS__c"] ? String(rec["WBS__c"]) : null,
      endDate: null,
      quantity: rec["Quantity"] != null ? String(rec["Quantity"]) : null,
      amountEur: String(rec["TotalPrice"] ?? rec["amount_eur"] ?? "0").replace(/\s/g, ""),
    });
  }
  void importYear;
  return { rows, totalInputRows: records.length, skipped, hasMasterProductKeyColumn: hasKey };
}

export function parseSfArCsvOrEmpty(csvText: string, importYear: number) {
  if (!csvText.trim()) return parseSfArExportCsv("", importYear);
  return parseSfArExportCsv(csvText, importYear);
}

function parseIsoDateParts(raw: unknown): { year: number; month: number; day: number } | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  const day = Number.parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** Flatten parent `CallForResources__c` + subquery line rows into `ArLineItem` (API sync). */
export function flattenSalesforceArParentsToLineItems(
  parents: Record<string, unknown>[],
  importYear: number
): ArLineItem[] {
  const out: ArLineItem[] = [];
  for (const p of parents) {
    const contractNumber = String(p["Name"] ?? "").trim();
    const contractName = p["Contract_Name__c"] != null ? String(p["Contract_Name__c"]) : null;
    const counterpartReference =
      p["Counterpart_Reference__c"] != null ? String(p["Counterpart_Reference__c"]) : null;
    const clientName =
      p["Account"] && typeof p["Account"] === "object" && p["Account"] !== null
        ? String((p["Account"] as { Name?: string }).Name ?? "").trim() || null
        : null;
    const signedParts = parseIsoDateParts(p["Signed_Date__c"]);

    const rel = p["CallForResourcesLineItems__r"] as
      | { records?: Record<string, unknown>[] }
      | undefined;
    const kids = Array.isArray(rel?.records) ? rel!.records! : [];
    for (const c of kids) {
      const status = String(c["Document_Status__c"] ?? "").trim();
      if (!DOC_OK.has(status)) continue;
      const uniqueArId = String(c["Unique_AR_ID__c"] ?? "").trim();
      const lineItemNumber = String(c["Line_Item_Number__c"] ?? "").trim();
      const totalPrice = String(c["TotalPrice"] ?? "").trim();
      if (!uniqueArId || !contractNumber || !lineItemNumber || !totalPrice) continue;

      const endParts = parseIsoDateParts(c["EndDate"]);

      const pe = c["PricebookEntry"] as {
        Name?: string;
        Product2?: { Name?: string; ProductCode?: string };
      } | undefined;
      const sellable =
        (pe?.Name && String(pe.Name).trim()) ||
        (pe?.Product2?.Name && String(pe.Product2.Name).trim()) ||
        String(c["Description"] ?? "").trim() ||
        "—";

      const masterName = pe?.Product2?.Name ? String(pe.Product2.Name).trim() || null : null;
      const masterKey = pe?.Product2?.ProductCode
        ? String(pe.Product2.ProductCode).trim() || null
        : null;

      out.push({
        uniqueArId,
        contractNumber,
        contractName,
        counterpartReference,
        lineItemNumber,
        documentStatus: status,
        signedDate: signedParts,
        clientName,
        sfMasterProductName: masterName,
        sfMasterProductKey: masterKey,
        sfProductName: sellable,
        description: c["Description"] != null ? String(c["Description"]) : null,
        sapProductCode: c["SAP_Product_Code__c"] != null ? String(c["SAP_Product_Code__c"]) : null,
        sapSoNumber: c["SAP_SO_Number__c"] != null ? String(c["SAP_SO_Number__c"]) : null,
        wbs: c["WBS__c"] != null ? String(c["WBS__c"]) : null,
        endDate: endParts,
        quantity: c["Quantity"] != null ? String(c["Quantity"]) : null,
        amountEur: totalPrice.replace(/\s/g, ""),
      });
    }
  }
  void importYear;
  return out;
}

