-- Canonical EOTP catalog (budget owner, team, SAP code, label) from EOTP-Budget-Owner.csv

CREATE TABLE "eotp_definition" (
    "id" TEXT NOT NULL,
    "sap_eotp_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "division" TEXT,
    "budget_owner" TEXT,
    "director" TEXT,
    "sub_division" TEXT,
    "team" TEXT,
    "created_on" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_on" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eotp_definition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "eotp_definition_sap_eotp_code_label_key" ON "eotp_definition"("sap_eotp_code", "label");

CREATE INDEX "eotp_definition_sap_eotp_code_idx" ON "eotp_definition"("sap_eotp_code");

ALTER TABLE "allocation_entity" ADD COLUMN "eotp_definition_id" TEXT;

ALTER TABLE "eotp_routing" ADD COLUMN "eotp_definition_id" TEXT;

ALTER TABLE "allocation_entity"
  ADD CONSTRAINT "allocation_entity_eotp_definition_id_fkey"
  FOREIGN KEY ("eotp_definition_id") REFERENCES "eotp_definition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "eotp_routing"
  ADD CONSTRAINT "eotp_routing_eotp_definition_id_fkey"
  FOREIGN KEY ("eotp_definition_id") REFERENCES "eotp_definition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "allocation_entity_eotp_definition_id_idx" ON "allocation_entity"("eotp_definition_id");

CREATE INDEX "eotp_routing_eotp_definition_id_idx" ON "eotp_routing"("eotp_definition_id");
