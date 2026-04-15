-- Multiple revenue lines per initiative + RevenueType enum

DROP INDEX IF EXISTS "initiative_revenue_initiative_id_key";

CREATE TYPE "RevenueType" AS ENUM ('Mission', 'Subscription');

ALTER TABLE "initiative_revenue" ADD COLUMN "type" "RevenueType" NOT NULL DEFAULT 'Mission';

CREATE INDEX "initiative_revenue_initiative_id_idx" ON "initiative_revenue"("initiative_id");
