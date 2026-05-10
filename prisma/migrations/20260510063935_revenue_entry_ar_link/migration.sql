-- AlterTable: add new columns (sap_doc_type as nullable first to allow backfill)
ALTER TABLE "revenue_entry" ADD COLUMN     "ar_entry_id" TEXT,
ADD COLUMN     "ext_doc_ref" TEXT,
ADD COLUMN     "sap_doc_type" TEXT;

-- Backfill existing rows: assume historical imports are normal invoices (ZCS, positive amount).
-- ZCR credit notes only enter the table from imports running the new parser.
UPDATE "revenue_entry" SET "sap_doc_type" = 'ZCS' WHERE "sap_doc_type" IS NULL;

-- Enforce NOT NULL after backfill
ALTER TABLE "revenue_entry" ALTER COLUMN "sap_doc_type" SET NOT NULL;

-- CreateIndex
CREATE INDEX "revenue_entry_ar_entry_id_idx" ON "revenue_entry"("ar_entry_id");

-- CreateIndex
CREATE INDEX "revenue_entry_ext_doc_ref_idx" ON "revenue_entry"("ext_doc_ref");

-- AddForeignKey
ALTER TABLE "revenue_entry" ADD CONSTRAINT "revenue_entry_ar_entry_id_fkey" FOREIGN KEY ("ar_entry_id") REFERENCES "ar_entry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
