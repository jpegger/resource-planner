export type ArMatchedInvoice = {
  invoiceNr: string;
  year: number;
  month: number;
  amountEur: number;
  eotp: string | null;
  productLabel: string | null;
  salesOrder: string | null;
};

export type ArReportSummary = {
  lineCount: number;
  totalEur: number;
  mappedCount: number;
  warningCount: number;
  /** AR lines on this page/filter with ≥1 matched `revenue_entry` row (SO + product label + year). */
  matchedLineCount: number;
  /** Sum of matched invoice amounts (EUR) across all filtered AR lines (not deduplicated across lines). */
  matchedTotalEur: number;
  byStatus: { status: string; count: number; sumEur: number }[];
  topClients: { client: string; sumEur: number }[];
  topProducts: { productName: string; allocationEntityId: string | null; sumEur: number }[];
};

export type ArReportLine = {
  id: string;
  importId: string;
  uniqueArId: string;
  contractNumber: string;
  contractName: string | null;
  counterpartReference: string | null;
  lineItemNumber: string;
  documentStatus: string;
  signedDate: string | null;
  clientName: string | null;
  sfMasterProductName: string | null;
  sfMasterProductKey: string | null;
  sfProductName: string;
  description: string | null;
  sapProductCode: string | null;
  sapSoNumber: string | null;
  wbs: string | null;
  endDate: string | null;
  quantity: number | null;
  amountEur: number;
  year: number;
  allocationEntityId: string | null;
  allocationEntityName: string | null;
  division: string | null;
  subDivision: string | null;
  team: string | null;
  sapEotpCode: string | null;
  importWarning: string | null;
  /** Count of `revenue_entry` rows matching this AR line (normalized SO + product + year). */
  matchCount: number;
  /** Sum of matched `revenue_entry.amount_eur` for this line. */
  matchedAmountEur: number;
  matchedInvoices: ArMatchedInvoice[];
};

export type ArReportResponse = {
  meta: {
    year: number;
    total: number;
    limit: number;
    offset: number;
    filters: Record<string, string | boolean | string[] | undefined>;
  };
  summary: ArReportSummary;
  lines: ArReportLine[];
};
