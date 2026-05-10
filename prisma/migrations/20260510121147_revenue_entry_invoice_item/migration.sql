-- Add SAP invoice line item ("Poste", col 48) so a single SAP invoice can carry
-- multiple revenue_entry rows (one per Désignation poste / Article line).
--
-- Existing rows are backfilled to 0 (a single legacy row per (sap_invoice_nr, year)
-- already collapsed all line items into one — keep them addressable, then re-import
-- to recover the per-line breakdown).

ALTER TABLE "revenue_entry"
  ADD COLUMN "sap_invoice_item" INTEGER;

UPDATE "revenue_entry" SET "sap_invoice_item" = 0 WHERE "sap_invoice_item" IS NULL;

ALTER TABLE "revenue_entry"
  ALTER COLUMN "sap_invoice_item" SET NOT NULL;

-- Replace the (sap_invoice_nr, year) unique with (sap_invoice_nr, year, sap_invoice_item).
DROP INDEX IF EXISTS "revenue_entry_sap_invoice_nr_year_key";
CREATE UNIQUE INDEX "revenue_entry_sap_invoice_nr_year_sap_invoice_item_key"
  ON "revenue_entry" ("sap_invoice_nr", "year", "sap_invoice_item");
