-- CreateEnum
CREATE TYPE "eotp_cost_type" AS ENUM ('INTERNAL', 'EXTERNAL', 'DIRECT');

-- CreateEnum
CREATE TYPE "eotp_value_type" AS ENUM ('PERCENT', 'AMOUNT');

-- CreateTable
CREATE TABLE "eotp_routing" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "costType" "eotp_cost_type" NOT NULL,
    "eotp" TEXT NOT NULL,
    "eopLabel" TEXT,
    "valueType" "eotp_value_type" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "comment" TEXT,
    "createdOn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eotp_routing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "eotp_routing_productId_year_costType_eotp_key" ON "eotp_routing"("productId", "year", "costType", "eotp");

-- AddForeignKey
ALTER TABLE "eotp_routing" ADD CONSTRAINT "eotp_routing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
