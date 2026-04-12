-- DropIndex
DROP INDEX "allocation_entity_eotp_definition_id_idx";

-- DropIndex
DROP INDEX "eotp_definition_sap_eotp_code_idx";

-- DropIndex
DROP INDEX "eotp_routing_eotp_definition_id_idx";

-- AlterTable
ALTER TABLE "eotp_definition" ALTER COLUMN "modified_on" DROP DEFAULT;

-- CreateTable
CREATE TABLE "allocation_snapshot" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenBy" TEXT NOT NULL,
    "createdOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_snapshot_row" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "eotp" TEXT NOT NULL,
    "eopLabel" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "internal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "external" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "direct" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "allocation_snapshot_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_baseline" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedBy" TEXT NOT NULL,
    "createdOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_baseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_baseline_row" (
    "id" TEXT NOT NULL,
    "baselineId" TEXT NOT NULL,
    "eotp" TEXT NOT NULL,
    "eopLabel" TEXT,
    "cellule" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "budget_baseline_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dim_year" (
    "year" INTEGER NOT NULL,

    CONSTRAINT "dim_year_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE INDEX "allocation_snapshot_row_snapshotId_idx" ON "allocation_snapshot_row"("snapshotId");

-- CreateIndex
CREATE INDEX "allocation_snapshot_row_eotp_idx" ON "allocation_snapshot_row"("eotp");

-- CreateIndex
CREATE INDEX "budget_baseline_row_baselineId_idx" ON "budget_baseline_row"("baselineId");

-- CreateIndex
CREATE INDEX "budget_baseline_row_eotp_idx" ON "budget_baseline_row"("eotp");

-- AddForeignKey
ALTER TABLE "allocation_snapshot_row" ADD CONSTRAINT "allocation_snapshot_row_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "allocation_snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_baseline_row" ADD CONSTRAINT "budget_baseline_row_baselineId_fkey" FOREIGN KEY ("baselineId") REFERENCES "budget_baseline"("id") ON DELETE CASCADE ON UPDATE CASCADE;
