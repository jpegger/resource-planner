-- CreateTable
CREATE TABLE "sn_programme_mapping" (
    "id" TEXT NOT NULL,
    "sn_programme_name" TEXT NOT NULL,
    "sn_programme_eotp" TEXT,
    "allocation_entity_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sn_programme_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sn_project_mapping" (
    "id" TEXT NOT NULL,
    "sn_project_nr" TEXT NOT NULL,
    "sn_project_name" TEXT,
    "initiative_id" TEXT,
    "year" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sn_project_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sf_master_product_mapping" (
    "id" TEXT NOT NULL,
    "sf_master_product_name" TEXT NOT NULL,
    "sf_master_product_key" TEXT,
    "allocation_entity_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sf_master_product_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_import" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "imported_by" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "warn_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timesheet_entry" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "sn_user" TEXT NOT NULL,
    "sn_programme_name" TEXT,
    "sn_project_nr" TEXT,
    "sn_project_label" TEXT,
    "sn_task_nr" TEXT,
    "sn_task_label" TEXT,
    "week_starts_on" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "state" TEXT NOT NULL,
    "allocation_entity_id" TEXT,
    "initiative_id" TEXT,
    "resource_id" TEXT,
    "import_warning" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timesheet_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_import" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "imported_by" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "warn_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_entry" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "sap_vim_doc_id" TEXT NOT NULL,
    "sap_reservation_nr" TEXT,
    "sap_vendor_code" TEXT,
    "vendor_name" TEXT,
    "eotp_full_path" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount_eur" DECIMAL(12,2) NOT NULL,
    "compte_budgetaire" TEXT NOT NULL,
    "cost_type" TEXT NOT NULL DEFAULT 'EXTERNAL',
    "eotp_definition_id" TEXT,
    "import_warning" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_import" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "imported_by" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "warn_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ar_entry" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "unique_ar_id" TEXT NOT NULL,
    "contract_number" TEXT NOT NULL,
    "contract_name" TEXT,
    "counterpart_reference" TEXT,
    "line_item_number" TEXT NOT NULL,
    "document_status" TEXT NOT NULL,
    "signed_date" DATE,
    "client_name" TEXT,
    "sf_master_product_name" TEXT,
    "sf_master_product_key" TEXT,
    "sf_product_name" TEXT NOT NULL,
    "description" TEXT,
    "sap_product_code" TEXT,
    "sap_so_number" TEXT,
    "wbs" TEXT,
    "end_date" DATE,
    "quantity" DECIMAL(12,2),
    "amount_eur" DECIMAL(12,2) NOT NULL,
    "year" INTEGER NOT NULL,
    "allocation_entity_id" TEXT,
    "import_warning" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ar_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_import" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "imported_by" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "warn_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_entry" (
    "id" TEXT NOT NULL,
    "import_id" TEXT NOT NULL,
    "sap_invoice_nr" TEXT NOT NULL,
    "sap_sales_order" TEXT,
    "client_name" TEXT,
    "sap_article_code" TEXT,
    "product_label" TEXT,
    "eotp_full" TEXT,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount_eur" DECIMAL(12,2) NOT NULL,
    "allocation_entity_id" TEXT,
    "import_warning" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sn_programme_mapping_sn_programme_name_key" ON "sn_programme_mapping"("sn_programme_name");

-- CreateIndex
CREATE INDEX "sn_project_mapping_sn_project_nr_year_idx" ON "sn_project_mapping"("sn_project_nr", "year");

-- CreateIndex
CREATE UNIQUE INDEX "sf_master_product_mapping_sf_master_product_name_key" ON "sf_master_product_mapping"("sf_master_product_name");

-- CreateIndex
CREATE INDEX "timesheet_entry_import_id_idx" ON "timesheet_entry"("import_id");

-- CreateIndex
CREATE INDEX "timesheet_entry_allocation_entity_id_idx" ON "timesheet_entry"("allocation_entity_id");

-- CreateIndex
CREATE INDEX "invoice_entry_import_id_idx" ON "invoice_entry"("import_id");

-- CreateIndex
CREATE INDEX "invoice_entry_eotp_definition_id_idx" ON "invoice_entry"("eotp_definition_id");

-- CreateIndex
CREATE INDEX "ar_entry_import_id_idx" ON "ar_entry"("import_id");

-- CreateIndex
CREATE INDEX "ar_entry_allocation_entity_id_idx" ON "ar_entry"("allocation_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "ar_entry_unique_ar_id_year_key" ON "ar_entry"("unique_ar_id", "year");

-- CreateIndex
CREATE INDEX "revenue_entry_import_id_idx" ON "revenue_entry"("import_id");

-- CreateIndex
CREATE INDEX "revenue_entry_allocation_entity_id_idx" ON "revenue_entry"("allocation_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_entry_sap_invoice_nr_year_key" ON "revenue_entry"("sap_invoice_nr", "year");

-- AddForeignKey
ALTER TABLE "sn_programme_mapping" ADD CONSTRAINT "sn_programme_mapping_allocation_entity_id_fkey" FOREIGN KEY ("allocation_entity_id") REFERENCES "allocation_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sn_project_mapping" ADD CONSTRAINT "sn_project_mapping_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sf_master_product_mapping" ADD CONSTRAINT "sf_master_product_mapping_allocation_entity_id_fkey" FOREIGN KEY ("allocation_entity_id") REFERENCES "allocation_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "timesheet_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_allocation_entity_id_fkey" FOREIGN KEY ("allocation_entity_id") REFERENCES "allocation_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_entry" ADD CONSTRAINT "timesheet_entry_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_entry" ADD CONSTRAINT "invoice_entry_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "invoice_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_entry" ADD CONSTRAINT "invoice_entry_eotp_definition_id_fkey" FOREIGN KEY ("eotp_definition_id") REFERENCES "eotp_definition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_entry" ADD CONSTRAINT "ar_entry_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "ar_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ar_entry" ADD CONSTRAINT "ar_entry_allocation_entity_id_fkey" FOREIGN KEY ("allocation_entity_id") REFERENCES "allocation_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_entry" ADD CONSTRAINT "revenue_entry_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "revenue_import"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_entry" ADD CONSTRAINT "revenue_entry_allocation_entity_id_fkey" FOREIGN KEY ("allocation_entity_id") REFERENCES "allocation_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
