-- Simplify eotp_routing: three EUR columns per row (no percent / no per-cost-type rows).
-- Drops dependent views; next migration recreates them (requires v_allocation_costs).

DROP VIEW IF EXISTS v_eotp_routing;
DROP VIEW IF EXISTS v_eotp_costs;

TRUNCATE TABLE "eotp_routing";

ALTER TABLE "eotp_routing" DROP CONSTRAINT IF EXISTS "eotp_routing_productId_year_costType_eotp_key";

ALTER TABLE "eotp_routing" DROP COLUMN "costType";
ALTER TABLE "eotp_routing" DROP COLUMN "valueType";
ALTER TABLE "eotp_routing" DROP COLUMN "value";

ALTER TABLE "eotp_routing" ADD COLUMN "internalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "eotp_routing" ADD COLUMN "externalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "eotp_routing" ADD COLUMN "directAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX "eotp_routing_productId_year_eotp_key" ON "eotp_routing"("productId", "year", "eotp");

DROP TYPE IF EXISTS "eotp_cost_type";
DROP TYPE IF EXISTS "eotp_value_type";
