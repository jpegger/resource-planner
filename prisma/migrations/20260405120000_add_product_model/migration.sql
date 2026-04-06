-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productFamily" TEXT,
    "division" TEXT,
    "subDivision" TEXT,
    "team" TEXT,
    "sapEotp" TEXT,
    "attractiveness" DOUBLE PRECISION,
    "competitiveness" DOUBLE PRECISION,
    "createdOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "product_name_key" ON "product"("name");

-- AlterTable
ALTER TABLE "initiative" ADD COLUMN "productId" TEXT;

-- AddForeignKey
ALTER TABLE "initiative" ADD CONSTRAINT "initiative_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
