-- Split sapEotp into sapEotpCode (identifier) and sapEotpName (label after first " - ")
-- View references product columns — drop first, recreate via seed (db:view:prod).

DROP VIEW IF EXISTS v_allocation_costs;

ALTER TABLE "product" ADD COLUMN "sapEotpCode" TEXT;
ALTER TABLE "product" ADD COLUMN "sapEotpName" TEXT;

UPDATE "product"
SET
  "sapEotpCode" = CASE
    WHEN "sapEotp" IS NULL OR TRIM(BOTH FROM "sapEotp") = '' THEN NULL
    WHEN POSITION(' - ' IN "sapEotp") > 0 THEN
      TRIM(BOTH FROM SUBSTRING("sapEotp" FROM 1 FOR POSITION(' - ' IN "sapEotp") - 1))
    ELSE TRIM(BOTH FROM "sapEotp")
  END,
  "sapEotpName" = CASE
    WHEN "sapEotp" IS NULL OR TRIM(BOTH FROM "sapEotp") = '' THEN NULL
    WHEN POSITION(' - ' IN "sapEotp") > 0 THEN
      TRIM(BOTH FROM SUBSTRING("sapEotp" FROM POSITION(' - ' IN "sapEotp") + 3))
    ELSE NULL
  END;

ALTER TABLE "product" DROP COLUMN "sapEotp";
