-- CreateTable
CREATE TABLE "sap_designation_mapping" (
    "id" TEXT NOT NULL,
    "sap_designation" TEXT NOT NULL,
    "sf_product_name" TEXT,
    "allocation_entity_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sap_designation_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sap_designation_mapping_sap_designation_key" ON "sap_designation_mapping"("sap_designation");

-- AddForeignKey
ALTER TABLE "sap_designation_mapping" ADD CONSTRAINT "sap_designation_mapping_allocation_entity_id_fkey" FOREIGN KEY ("allocation_entity_id") REFERENCES "allocation_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
