-- Make `eotp_definition.sap_eotp_code` unique (one row per SAP code).
-- Previously the catalog allowed multiple rows per SAP code with different labels.
--
-- This migration:
-- 1) Deduplicates existing rows (keeps the "best" row per code).
-- 2) Re-points optional FKs from dropped rows to the kept row.
-- 3) Replaces the unique index (sap_eotp_code, label) with a unique index on sap_eotp_code.

WITH ranked AS (
  SELECT
    id,
    sap_eotp_code,
    ROW_NUMBER() OVER (
      PARTITION BY sap_eotp_code
      ORDER BY
        (budget_owner IS NOT NULL) DESC,
        (team IS NOT NULL) DESC,
        modified_on DESC,
        id ASC
    ) AS rn
  FROM eotp_definition
),
keep AS (
  SELECT id, sap_eotp_code
  FROM ranked
  WHERE rn = 1
),
drop_rows AS (
  SELECT id, sap_eotp_code
  FROM ranked
  WHERE rn > 1
)
UPDATE allocation_entity ae
SET eotp_definition_id = k.id
FROM drop_rows d
JOIN keep k ON k.sap_eotp_code = d.sap_eotp_code
WHERE ae.eotp_definition_id = d.id;

WITH ranked AS (
  SELECT
    id,
    sap_eotp_code,
    ROW_NUMBER() OVER (
      PARTITION BY sap_eotp_code
      ORDER BY
        (budget_owner IS NOT NULL) DESC,
        (team IS NOT NULL) DESC,
        modified_on DESC,
        id ASC
    ) AS rn
  FROM eotp_definition
),
keep AS (
  SELECT id, sap_eotp_code
  FROM ranked
  WHERE rn = 1
),
drop_rows AS (
  SELECT id, sap_eotp_code
  FROM ranked
  WHERE rn > 1
)
UPDATE eotp_routing er
SET eotp_definition_id = k.id
FROM drop_rows d
JOIN keep k ON k.sap_eotp_code = d.sap_eotp_code
WHERE er.eotp_definition_id = d.id;

WITH ranked AS (
  SELECT
    id,
    sap_eotp_code,
    ROW_NUMBER() OVER (
      PARTITION BY sap_eotp_code
      ORDER BY
        (budget_owner IS NOT NULL) DESC,
        (team IS NOT NULL) DESC,
        modified_on DESC,
        id ASC
    ) AS rn
  FROM eotp_definition
)
DELETE FROM eotp_definition
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DROP INDEX IF EXISTS "eotp_definition_sap_eotp_code_label_key";
CREATE UNIQUE INDEX "eotp_definition_sap_eotp_code_key" ON "eotp_definition"("sap_eotp_code");
