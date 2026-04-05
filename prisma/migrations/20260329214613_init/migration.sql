-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('INTERNAL', 'EXTERNAL', 'DIRECT_COST');

-- CreateEnum
CREATE TYPE "InitiativeStatus" AS ENUM ('IN_PROGRESS', 'DONE', 'SELECTED_FOR_DEVELOPMENT', 'RFP');

-- CreateEnum
CREATE TYPE "InitiativeType" AS ENUM ('RUN', 'EVOLUTION', 'ROLLOUT', 'PROJET', 'NOUVEAU_SERVICE', 'ANALYSE', 'EVOLUTION_TECHNIQUE', 'PRODUCT_ACTIVATION', 'DECOMMISSIONNEMENT', 'LEGAL');

-- CreateTable
CREATE TABLE "resource" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "function" TEXT,
    "cellule" TEXT,
    "direction" TEXT,
    "type" "ResourceType" NOT NULL,
    "createdOn" TIMESTAMP(3) NOT NULL,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "dailyRate" DOUBLE PRECISION NOT NULL,
    "nbrDaysPerYear" DOUBLE PRECISION,
    "createdOn" TIMESTAMP(3) NOT NULL,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_standard" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "type" "ResourceType" NOT NULL,
    "dailyRate" DOUBLE PRECISION NOT NULL,
    "nbrDaysPerYear" INTEGER NOT NULL,
    "createdOn" TIMESTAMP(3) NOT NULL,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_standard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiative" (
    "id" TEXT NOT NULL,
    "powerId" TEXT,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "components" TEXT,
    "productGroup" TEXT,
    "initiativeType" TEXT,
    "createdOn" TIMESTAMP(3) NOT NULL,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "initiative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation" (
    "id" TEXT NOT NULL,
    "externalId" TEXT,
    "initiativeId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "manDays" DOUBLE PRECISION,
    "quantity" DOUBLE PRECISION,
    "createdOn" TIMESTAMP(3) NOT NULL,
    "modifiedOn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_resourceId_year_key" ON "rate"("resourceId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "rate_standard_year_type_key" ON "rate_standard"("year", "type");

-- CreateIndex
CREATE UNIQUE INDEX "initiative_powerId_key" ON "initiative"("powerId");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_externalId_key" ON "allocation"("externalId");

-- AddForeignKey
ALTER TABLE "rate" ADD CONSTRAINT "rate_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_initiativeId_fkey" FOREIGN KEY ("initiativeId") REFERENCES "initiative"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation" ADD CONSTRAINT "allocation_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
