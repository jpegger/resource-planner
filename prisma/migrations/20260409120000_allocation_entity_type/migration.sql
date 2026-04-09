-- CreateEnum
CREATE TYPE "AllocationEntityType" AS ENUM ('PRODUCT', 'PROJECT', 'PROGRAM', 'INFRASTRUCTURE', 'TEAM');

-- AlterTable
ALTER TABLE "product" ADD COLUMN "entity_type" "AllocationEntityType" NOT NULL DEFAULT 'PRODUCT';
