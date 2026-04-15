CREATE TABLE "initiative_revenue" (
    "id"             TEXT NOT NULL,
    "initiative_id"  TEXT NOT NULL,
    "amount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "comment"        TEXT,
    "created_on"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modified_on"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "initiative_revenue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "initiative_revenue_initiative_id_key"
    ON "initiative_revenue"("initiative_id");

ALTER TABLE "initiative_revenue"
    ADD CONSTRAINT "initiative_revenue_initiative_id_fkey"
    FOREIGN KEY ("initiative_id")
    REFERENCES "initiative"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
