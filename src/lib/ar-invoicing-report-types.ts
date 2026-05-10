export type ArInvoicingSapRow = {
  sapDocType: string;
  sapInvoiceNr: string;
  sapSalesOrder: string | null;
  month: number;
  year: number;
  amountEur: number;
  sapDesignation: string | null;
  sapArticleCode: string | null;
  extDocRef: string | null;
  /**
   * How this revenue row was tied to the AR line.
   * - `ar_entry_id` — explicit FK from `revenue_entry.ar_entry_id` (resolver step 1).
   * - `heuristic`   — fallback `(sap_so_number, designation)` match.
   * - `unmatched`   — `ext_doc_ref` carries this AR's counterpart reference but no AR
   *                   line item matches; surfaced under the synthetic
   *                   "Unmatched line items" row of the group.
   */
  linkSource: "ar_entry_id" | "heuristic" | "unmatched";
  invoicedProductName: string | null;
  invoicedProductId: string | null;
  division: string | null;
  subDivision: string | null;
  productFamily: string | null;
};

export type ArInvoicingReportLine = {
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
  sfProductName: string;
  description: string | null;
  sapSoNumber: string | null;
  quantity: number | null;
  amountEur: number;
  year: number;
  allocationEntityId: string | null;
  allocationEntityName: string | null;
  arDivision: string | null;
  arSubDivision: string | null;
  arProductFamily: string | null;
  importWarning: string | null;
  invoices: ArInvoicingSapRow[];
  invoicedTotalEur: number;
  invoiceRowCount: number;
};

export type ArInvoicingReportSummary = {
  lineCount: number;
  totalArEur: number;
  linesWithInvoicing: number;
  linesWithoutInvoicing: number;
  totalInvoicedEur: number;
};

/**
 * SAP `revenue_entry` rows that carry an `ext_doc_ref` matching an AR
 * counterpart_reference on the current page, but whose `Désignation poste`
 * matches no AR line item (via FK or SO + product-label heuristic).
 *
 * One bucket per `(counterpart_reference, allocation_entity_id)` — so a
 * group can carry several synthetic rows (e.g. one for each `sap_designation_mapping`
 * target, one for the still-unmapped tail).
 */
export type ArInvoicingUnmatchedBucket = {
  counterpartReference: string;
  /** `null` when the designation is not (yet) mapped to any allocation entity. */
  allocationEntityId: string | null;
  allocationEntityName: string | null;
  allocationEntityDivision: string | null;
  allocationEntitySubDivision: string | null;
  allocationEntityProductFamily: string | null;
  rowCount: number;
  invoicedTotalEur: number;
  invoices: ArInvoicingSapRow[];
};

export type ArInvoicingReportResponse = {
  meta: {
    /** `null` = no year filter applied (cross-year view). */
    year: number | null;
    total: number;
    limit: number;
    offset: number;
    filters: Record<string, string | boolean | string[] | undefined>;
    /**
     * All distinct years present in `ar_entry` ∪ `revenue_entry`, sorted
     * ascending. Drives the "Year" filter dropdown so it always reflects the
     * data actually on hand (instead of a hard-coded ±1 window around today).
     */
    availableYears: number[];
  };
  summary: ArInvoicingReportSummary;
  lines: ArInvoicingReportLine[];
  /** Counterpart-referenced SAP rows that match no AR line item on this page. */
  unmatched: ArInvoicingUnmatchedBucket[];
};
