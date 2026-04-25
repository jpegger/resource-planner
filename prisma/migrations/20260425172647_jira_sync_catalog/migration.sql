/*
  Warnings:

  - A unique constraint covering the columns `[jira_key]` on the table `allocation_entity` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "allocation_entity" ADD COLUMN     "jira_issue_id" TEXT,
ADD COLUMN     "jira_key" TEXT,
ADD COLUMN     "jira_last_synced_at" TIMESTAMP(3),
ADD COLUMN     "jira_status" TEXT,
ADD COLUMN     "jira_updated_at" TIMESTAMP(3),
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "initiative" ADD COLUMN     "allocation_mapping_source" TEXT,
ADD COLUMN     "component_name_fallback" TEXT,
ADD COLUMN     "jira_issue_id" TEXT,
ADD COLUMN     "jira_last_synced_at" TIMESTAMP(3),
ADD COLUMN     "jira_updated_at" TIMESTAMP(3),
ADD COLUMN     "linked_product_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "allocation_entity_jira_key_key" ON "allocation_entity"("jira_key");
