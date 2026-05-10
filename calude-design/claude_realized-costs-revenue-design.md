# Resource Planner — Realized Costs & Revenue Extension
## Design Document v2.5 — May 2026
### Updated: SF API integration · SN EOTP direct mapping · VIM cost type · AR-invoice link · ZCR credit notes · SAP invoice line items (`Poste`) in revenue UPSERT key

---

## 1. Overview

This document extends the Resource Planner to cover **realized costs** and **revenue** using
the same data sources the CRPS team currently processes manually in Excel, but ingested
directly — via API where possible, via CSV upload as a fallback.

The goal is the "Nouvelle version": costs and revenues aggregated at **EOTP/Product level**,
sourced exclusively from SAP and ServiceNow, replacing the old Excel-based comparison.

| # | Source | Integration mode | What it covers |
|---|---|---|---|
| 1 | ServiceNow timesheets | **API** (ITBM REST) — CSV fallback | Internal labour costs (realized) |
| 2 | SAP supplier invoices | **CSV upload** (`ZVIM_ANA_DETAIL`) | External + direct costs (realized) |
| 3 | Salesforce AR | **API** (SF Connected App, OAuth 2.0) — CSV fallback | Planned revenue (signed contracts) |
| 4 | SAP client invoices | **CSV upload** (`ZCOMM_REPORT`) | Realized revenue (invoiced to clients) |

**API vs CSV:** Sources 1 and 3 are being migrated to direct API calls. Authorization keys are
pending. Until they are available, the CSV upload path (already fully designed) serves as the
production flow. The API path is designed in parallel so it can be activated by a feature flag
without schema changes.

The **SAP Credit Bookings** and **Availability Checks** files are budget/commitment data only.
They are NOT imported into the realized layer.

---

## 2. What Already Exists (do not touch)

- `allocation_entity`, `initiative`, `allocation`, `rate`, `rate_standard` — planning layer
- `eotp_definition` — EOTP catalog with ownership (division / sub_division / team / owner)
- `allocation_snapshot`, `snapshot_detail` — frozen planning snapshots
- `budget_baseline`, `baseline_detail` — SAP budget baseline import
- `v_allocation_costs`, `v_eotp_costs`, `v_snapshot_detail`, `v_baseline_detail`, `v_comparison` — existing views

---

## 3. Actual CSV Structures (from data analysis)

### 3.1 ServiceNow Timesheets — Integration

#### 3.1a Current CSV export: `SN_Time_Card_Export_YYYY.csv`

Comma-delimited. One row per person per week per task. Exported from the SN Platform Analytics
report `SN_Time_Card_Export_YYYY`.

| Column | Example | Notes |
|---|---|---|
| `user` | `Abdelhafid BOUDOUNT` | Full name — must match `resource` table |
| `top_task.top_program` | `Production & Delivery Support` | **Programme name** — used as fallback mapping key |
| `top_task.top_task` | `PRJ0010754` | **SN project number** (matches `ITBM_pm_project.Number`) |
| `top_task.short_description` | `P&D Support > SPRB` | Project label |
| `task` | `PRJTASK0015520` | Task number |
| `task.short_description` | `P&D Support>SPRB>Meetings` | Task label |
| `week_starts_on` | `06/01/2025` | Week start date (DD/MM/YYYY) |
| `sys_created_on` | `27/12/2024 16:52` | Creation timestamp |
| `category` | `Project/Project Task` | Filter: only import this category |
| `total` | `8` | **Hours** (divide by 8 for man-days at cost compute time) |
| `state` | `Processed` | Filter: import `Processed` and `Approved` only |

**Coming soon — EOTP field on Programme:**
ServiceNow will soon carry an EOTP code directly on the Programme record
(e.g. `top_task.top_program_eotp = '7/D/0024'`). When this field is present in the export,
it allows direct mapping to `allocation_entity` via `sapEotpCode` without the manual
`sn_programme_mapping` table. The column name in the CSV will be confirmed once SN
is configured; the parser will detect it by checking the header.

#### 3.1b API integration (pending authorisation)

ServiceNow exposes timesheet data via the **ITBM REST API** (Table API / Aggregate API).
A first integration test has been completed. Production OAuth keys are pending.

**Endpoint:** `GET /api/now/table/pm_project_task_time_card`
**Authentication:** OAuth 2.0 client credentials (client_id + client_secret)
**Filter params:** `sysparm_query=week_starts_on>=2025-01-01^category=Project/Project Task^stateINProcessed,Approved`
**Fields:** same columns as CSV export, requested via `sysparm_fields`

**Response shape:** JSON array of records, same field names as CSV columns.
The parser is shared between CSV and API paths — both produce the same `TimesheetRow[]` type.

**Feature flag:** `SN_IMPORT_MODE = 'api' | 'csv'` in environment variables.
When `'api'`: the import UI calls an internal endpoint that fetches from SN directly.
When `'csv'`: the import UI shows the file upload input. Default = `'csv'` until keys are live.

**API credentials storage:** `SN_CLIENT_ID` and `SN_CLIENT_SECRET` in `.env`.
Never stored in the database. Token refresh handled server-side in `src/lib/sn-client.ts`.

**Key observations (both modes):**
- Only `category = 'Project/Project Task'` rows are relevant.
- `total` is in **hours**. Store as hours; compute cost as `(hours / 8) × daily_rate`.
- Year and month extracted from `week_starts_on` date.

### 3.2 `ITBM_pm_project.csv` — ServiceNow Projects

Semicolon-delimited.

| Column | Example | Notes |
|---|---|---|
| `Number` | `PRJ0010061` | Project number — matches `top_task.top_task` in timesheet |
| `Project Name` | `We Pulse - 03 Track Communication` | Human label |
| `Project manager` | `Romain MIROUSE` | |
| `Number` (col 3) | `PGM0001084` | Programme number |
| `Program Name` | `We Pulse` | Programme name — matches `top_task.top_program` in timesheet |
| `Program manager` | `Rudy Therasse` | |
| `State` | `Work in Progress` | |

This file is the **bridge** between SN project numbers and programme names. At import time,
look up `top_task.top_task` (project number) here to get the programme name.

### 3.3 `ITBM_pm_project_task.csv` — ServiceNow Project Tasks

Semicolon-delimited.

| Column | Example | Notes |
|---|---|---|
| `Number` | `PRJTASK0031199` | Task number — matches `task` in timesheet |
| `Short description` | (free text) | Task label |
| `Top project` | `PRJUP72` | Parent project number |
| `Top program` | `IRISBOX` | Parent programme name |

This is a secondary reference — mainly useful for resolving tasks that have no direct project link.

### 3.4 `SAP_VIM_Factures_Fournisseurs.csv` — Supplier Invoices (External + Direct Costs)

Semicolon-delimited. Export from SAP transaction `ZVIM_ANA_DETAIL`, périmètre financier = 1700.

| Column | SAP name | Example | Notes |
|---|---|---|---|
| 0 | `Descr.` | `Approbation terminée` | **Status filter**: import only `Approbation terminée`. Skip `Annulé`. |
| 1 | `CtrPr` | `` | Company code |
| 2 | `ID doc VIM` | `580806` | VIM document ID — use as `sap_invoice_nr` |
| 3 | `Réservat.` | `2517110099` | Reservation/engagement number |
| 4 | `Fourn.` | `405030` | Vendor code |
| 5 | `NomSt` | `SNOWFLAKE INC.` | Vendor name |
| 6 | `Montant` | `7821,45` | **Amount EUR** (comma decimal, no thousands sep) |
| 7 | `Référence` | `CI-326954` | Reference |
| 8 | `Ctre fin.` | `372035001` | Financial centre |
| 9 | `Compte budgét.` | `1211` | Stored for reference only — **not used** to determine cost type. Skip `T_GRIR` (accrual). |
| 10 | `Date doc.` | `28/02/2025` | Invoice date (DD/MM/YYYY) → extract year + month |
| 11 | `Echéance` | `21/05/2025` | Due date |
| 12 | `Date cpt.` | `23/04/2025` | Accounting date |
| 13 | `Elément d'OTP` | `7/D/0056/001.02.02` | **Full EOTP path** — strip trailing comma, match against `eotp_definition` |

**Row filter (what to import vs skip):**
- `Descr. = 'Annulé'` → **skip** (cancelled invoice)
- `Compte budgét. = 'T_GRIR'` → **skip** (goods receipt/invoice receipt accrual — not a final liquidation)
- All other `Approbation terminée` rows → **import** regardless of `Compte budgét.` value

**Cost type:** `Compte budgét.` cannot reliably determine whether a cost is EXTERNAL or
DIRECT_COST — the same account code can appear on both types depending on the engagement
context. Store `compte_budgetaire` raw for traceability. The `cost_type` field is left as
`TEXT` with no CHECK constraint for VIM rows, defaulting to `'EXTERNAL'`. A future
enrichment step (manual override or additional SAP field) can refine this if needed.

**EOTP resolution:** The EOTP in this file is the **full path** (e.g. `7/D/0056/001.02.02`).
The `eotp_definition` table stores the **level-1 root code** (e.g. `7/D/0056`).
Match by extracting the root: `eotp_full.split('/')[0..2]` → `7/D/0056`.
Store both raw full path and resolved root FK.

### 3.5 Salesforce AR — Integration

#### 3.5a CSV export: `SalesForce_AR_export.csv`

Semicolon-delimited, outer-quoted. Each row is one **line item** of a Call for Resources (AR).
Exported from the SF report "AR DPM by Product" via Edit → Export → Details Only → CSV.

| Col | Name | Example | Notes |
|---|---|---|---|
| 0 | `Account Name` | `ADMINISTRATION COMMUNALE D'EVERE` | Client name |
| 1 | `Contract Number` | `00003410` | AR contract number |
| 2 | `Contract Name` | `CFR Services 2023` | Contract label |
| 3 | `Billing Account: Account Name` | `ADMINISTRATION COMMUNALE D'EVERE` | Billing client |
| 4 | `Shipping Account: Account Name` | `ADMINISTRATION COMMUNALE D'EVERE` | Shipping client |
| 5 | `Document Status` | `Signed` | **Status filter**: import `Signed` and `Approved` only |
| 6 | `Signed Date` | `17/03/2023` | Date signed (DD/MM/YYYY) |
| 7 | `Counterpart reference` | `AR-003410` | AR reference number |
| 8 | `Line Item Number` | `00000011` | Line item number within contract |
| 9 | `Unique AR ID` | `00003410-00000011` | **Unique key** — UPSERT key (with year) |
| 10 | `Price Book Entry: Product: Master Product: Product Name` | `_M-BackUp Online` | **Master product name** — mapping key. Empty = no master product. |
| 11 | `Product Name` | `BackUp Online - consommation To` | Sellable product name |
| 12 | `Description` | `Gestion des serveurs` | Line item description |
| 13 | `Quantity` | `3663,00` | Quantity (comma decimal) |
| 14 | `Sales Price` | `1,00` | Unit price EUR |
| 15 | `Total Price` | `3663,00` | **Line amount EUR** (comma decimal) |
| 16 | `WBS` | `8/R/M/0001/213` | WBS code — sometimes empty |
| 17 | `SAP Product Code` | `17082` | SAP product code (17072–17092) |
| 18 | `SAP SO Number` | `0000743739` | SAP Sales Order number |
| 19 | `End Date` | `31/12/2023` | Contract end date (DD/MM/YYYY) |
| *(future)* | `Price Book Entry: Product: Master Product: Product Key` | `BUO` | **Jira key** — when present, use directly instead of mapping table |

**Year derivation:** No explicit year column. Year = passed as import parameter.

**Status filter:** Import `Signed` and `Approved` rows. Skip `Draft`, `Presented`, `Cancelled`.

#### 3.5b API integration (pending authorisation keys)

Salesforce exposes AR data via the **Salesforce Connected App REST API** (SOQL queries
over the `CallForResources__c` and `CallForResourcesLineItems__c` objects).
A first integration test has been completed. OAuth client credentials are pending approval.

**Authentication:** OAuth 2.0 — Connected App, `client_credentials` flow
**Endpoint:** `POST /services/oauth2/token` for token, then `GET /services/data/vXX.0/query?q=...`

**SOQL query equivalent to the CSV report:**
```sql
SELECT
  Account.Name,
  Name,                                   -- Contract Number
  Contract_Name__c,
  Document_Status__c,
  Signed_Date__c,
  Counterpart_Reference__c,
  (SELECT
    Line_Item_Number__c,
    Unique_AR_ID__c,
    PricebookEntry.Product2.Family,        -- Master Product Name
    PricebookEntry.Product2.ProductCode,   -- Master Product Key (Jira key, future)
    PricebookEntry.Name,                   -- Product Name
    Description,
    Quantity,
    UnitPrice,                             -- Sales Price
    TotalPrice,
    WBS__c,
    SAP_Product_Code__c,
    SAP_SO_Number__c,
    EndDate
   FROM CallForResourcesLineItems__r
   WHERE Document_Status__c IN ('Signed','Approved')
  )
FROM CallForResources__c
WHERE CALENDAR_YEAR(Signed_Date__c) = :year
```

> **Note:** Exact object/field API names must be confirmed once access is granted.
> The field mapping above is indicative based on the CSV column names.

**Response shape:** JSON — same fields as CSV, parsed into `ArLineItem[]`.
The same `sf-ar-parser.ts` handles both CSV and API responses via a shared normaliser.

**Feature flag:** `SF_IMPORT_MODE = 'api' | 'csv'` in environment variables.
When `'api'`: UI shows a "Sync from Salesforce" button (no file upload). Triggers server call.
When `'csv'`: UI shows the file upload input. Default = `'csv'` until OAuth keys are live.

**API credentials storage:** `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_INSTANCE_URL` in `.env`.
Token refresh handled server-side in `src/lib/sf-client.ts`. Never stored in DB.

**Sync strategy:** Full re-sync per year on each API call. All rows for the year are fetched,
then UPSERTed on `(unique_ar_id, year)`. Deleted/cancelled contracts that no longer appear
in the API response are NOT automatically removed — this is intentional (audit trail).
A manual "delete import" action handles cleanup if needed.

**Key mapping — current (no Jira key yet):**
`Master Product Name` → `sf_master_product_mapping` table → `allocation_entity_id`.

**Key mapping — future (Jira key available):**
`Master Product Key` (Jira key from `PricebookEntry.Product2.ProductCode`) →
`allocation_entity.jiraKey` → direct match. Mapping table used as fallback only.

### 3.6 `SAP_Clients_Invoices.csv` — Realized Revenue

Semicolon-delimited. Export from SAP transaction `ZCOMM_REPORT`, périmètre financier = 1800 (IRISTEAM).

Key columns (from 68 total):

| Col | Name | Example | Notes |
|---|---|---|---|
| 0 | `Type document vente` | `ZCS` | **Document type**: `ZCS` = invoice, `ZCR` = credit note (reimbursement) |
| 4 | `Document de vente` | `701190` | SAP Sales Order number (`sap_doc_vente`) |
| 6 | `Nom` (client) | `COMMUNE D'EVERE` | Client name |
| 9 | `Créé le` | `16/03/2023` | Sales order creation date |
| 20 | `Article` | `17072` | SAP product code (17072–17092) |
| 23 | `Désignation poste` | `BackUp Online - consommation To` | **Line item label** = SF `Product Name` for current contracts |
| 31 | `Elément d'OTP` | `8/R/B/0014/001` | **Product EOTP** — fallback for pre-SF contracts |
| 40 | `Numéro externe de document de vente` | `AR-003410` | **AR counterpart reference** — primary link to `ar_entry` |
| 41 | `Facture` | `90590344` | **Invoice number** — part 1 of UPSERT key |
| 45 | `Valeur nette` | `33.260,48` | **Invoiced amount EUR** (dot thousands, comma decimal) |
| 48 | `Poste` | `30` | **Invoice line item** — part 3 of UPSERT key (one row per `Désignation poste`) |
| 58 | `Exercice comptable` | `2023` | **Accounting year** — part 2 of UPSERT key |
| 59 | `Date de la pièce` | `15/03/2023` | Invoice date → extract month (accepts `DD/MM/YYYY` and Excel serial) |

**Row filter:**
- `Facture` (col 41) is empty → **skip** (uninvoiced order lines)
- All other rows imported regardless of `Type document vente`

**ZCR credit notes:**
- `Type document vente = 'ZCR'` → `amount_eur` stored as **negative** (negate the parsed value)
- `Type document vente = 'ZCS'` → `amount_eur` stored as **positive**
- Credit notes appear as negative revenue in `v_realized_revenue`, naturally offsetting the original invoice

**Product resolution:** 4-step priority — see section 7.4 parser for full logic.
Primary: `col[40]` AR counterpart ref + `col[23]` designation → `ar_entry` match.
Fallback: `col[31]` EOTP root for pre-SF contracts.

### 3.7 `SAP_OTP_Structure.csv` and `SAP_OTP_Level1.csv`

These define the EOTP hierarchy. `SAP_OTP_Level1.csv` gives the clean root EOTP codes
(e.g. `7/D/0001`) and labels. These can be used to seed/validate `eotp_definition`.

---

## 4. Mapping Summary — Final Decisions

| Source | Raw key | Resolution (priority order) | New column needed |
|---|---|---|---|
| SN timesheets (future) | `top_task.top_program_eotp` (EOTP code) | `eotp_definition.eotp` → `allocation_entity.sapEotpCode` (direct) | None |
| SN timesheets (now) | `top_task.top_program` (Programme name) | `sn_programme_mapping` fallback table | None |
| SN timesheets | `top_task.top_task` (SN project number) | `sn_project_mapping` table (optional, initiative-level) | None |
| SAP VIM invoices | `Elément d'OTP` full path | Root extraction → `eotp_definition.eotp` | None |
| Salesforce AR (future) | `Master Product Key` (Jira key) | `allocation_entity.jiraKey` (direct) | None |
| Salesforce AR (now) | `Master Product Name` col 10 | `sf_master_product_mapping` fallback table | None |
| SAP Client invoices | `col[0]` doc type (ZCS/ZCR); `col[40]` `ext_doc_ref`; `col[23]` désignation poste; `col[31]` EOTP full; `col[41]` facture | **§7.4 — 4 steps:** **(1)** ref + désignation → `ar_entry` → `ar_entry_id` + inherit `allocation_entity_id`. **(2)** ref set, step 1 miss → `sap_designation_mapping`; if **`sf_product_name`** on mapping is set, retry **(1)** with that name + same ref; if AR found → same as step 1; else `allocation_entity_id` from mapping + warning. **(3)** ref **empty** → EOTP root from `col[31]` → `eotp_definition` / `allocation_entity`. **(4)** else NULL + warning. ZCR negates amount. | `revenue_entry.sap_doc_type`, `ext_doc_ref`, `ar_entry_id`; **`sap_designation_mapping`** |

### 4.1 SN Programme → Product: EOTP-first, mapping table fallback

**Current state:** The SN Programme carries only a free-text name. No EOTP.
**Coming soon:** SN will be configured to carry an EOTP code on the Programme record,
directly matching `allocation_entity.sapEotpCode`.

**Resolution logic (priority order):**

```
1. If top_task.top_program_eotp is present and non-empty in the data:
      → look up eotp_definition by eotp code
      → resolve to allocation_entity via allocation_entity.sapEotpCode
      → NO mapping table needed, NO warning

2. Else (EOTP field absent or empty):
      → look up sn_programme_mapping by sn_programme_name
      → resolve to allocation_entity_id via the managed mapping table
      → if not found in mapping table → allocation_entity_id = NULL + import_warning
```

This is the same pattern as the Salesforce AR: direct key takes priority, mapping table is
the fallback. The `sn_programme_mapping` table remains permanently as a fallback — it will
still be needed for legacy data, programmes without an EOTP set, or edge cases.

**`sn_programme_mapping` table** (managed in-app, pre-populated from Excel):

```sql
CREATE TABLE sn_programme_mapping (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sn_programme_name    TEXT NOT NULL UNIQUE,   -- exact SN programme name
  sn_programme_eotp    TEXT,                   -- EOTP code (filled when SN provides it)
  allocation_entity_id TEXT REFERENCES allocation_entity(id),
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
```

The `sn_programme_eotp` column on the mapping table itself means that when the SN EOTP
becomes available, the mapping table rows can be enriched in place. A row with
`sn_programme_eotp` set is shown with a "EOTP-resolved" badge in the mapping UI —
confirming the direct resolution path will work as soon as the CSV/API carries the field.

### 4.2 SN Project → Initiative: optional mapping table

```sql
CREATE TABLE sn_project_mapping (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sn_project_nr     TEXT NOT NULL,   -- e.g. PRJ0010754
  sn_project_name   TEXT,
  initiative_id     TEXT REFERENCES initiative(id),  -- optional
  year              INTEGER,         -- year scope (a project may map differently per year)
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
```

When `initiative_id` is NULL → costs roll up to product level only. Not a warning.

### 4.3 Salesforce AR → Product: Master Product mapping table

The SF AR export identifies products via a **Master Product Name** (e.g. `_M-BackUp Online`).
This is the commercial grouping name in Salesforce. It does not directly match any field
on `allocation_entity`. An intermediate mapping table is required:

```sql
CREATE TABLE sf_master_product_mapping (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sf_master_product_name  TEXT NOT NULL UNIQUE,  -- e.g. '_M-BackUp Online'
  sf_master_product_key   TEXT,                  -- Jira key from SF (null until SF exports it)
  allocation_entity_id    TEXT REFERENCES allocation_entity(id),
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
```

**Managed in-app** on the mapping UI page, pre-populated manually.

**Future-proofing for Jira key:** When the SF export adds the `Master Product Key` column
(containing `allocation_entity.jiraKey`), the parser will:
1. Check if the column `Price Book Entry: Product: Master Product: Product Key` exists in the CSV header.
2. If present and non-empty for a row → look up `allocation_entity` by `jiraKey` directly (no mapping table needed).
3. If absent or empty → fall back to `sf_master_product_mapping` lookup by name.

This means `sf_master_product_mapping` remains useful as a fallback even after the SF update —
rows with no master product key still need the name-based mapping.

Store `sf_master_product_key` on `sf_master_product_mapping` so that when the SF Jira key
becomes available, the mapping table can be enriched in place and the lookup path is
consistent across old and new imports.

### 4.4 EOTP format normalisation

VIM invoices use full paths: `7/D/0056/001.02.02`
`eotp_definition` stores root codes: `7/D/0056`

Extraction rule: split on `/`, take first 3 parts, rejoin:
`['7', 'D', '0056', '001.02.02'][:3]` → `7/D/0056`

SAP Client Invoices use a similar root format: `8/R/B/0014` (from `8/R/B/0014/001`).
Apply the same 3-segment extraction rule.

---

## 5. Schema — New Tables

### 5.1 `timesheet_import`

```sql
CREATE TABLE timesheet_import (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  file_name   TEXT NOT NULL,
  year        INTEGER NOT NULL,
  imported_by TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  warn_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 5.2 `timesheet_entry`

```sql
CREATE TABLE timesheet_entry (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  import_id            TEXT NOT NULL REFERENCES timesheet_import(id) ON DELETE CASCADE,

  -- Raw SN fields (always stored for traceability)
  sn_user              TEXT NOT NULL,          -- full name from 'user' column
  sn_programme_name    TEXT,                   -- top_task.top_program
  sn_project_nr        TEXT,                   -- top_task.top_task (e.g. PRJ0010754)
  sn_project_label     TEXT,                   -- top_task.short_description
  sn_task_nr           TEXT,                   -- task (e.g. PRJTASK0015520)
  sn_task_label        TEXT,                   -- task.short_description
  week_starts_on       DATE NOT NULL,          -- parsed from week_starts_on (DD/MM/YYYY)
  year                 INTEGER NOT NULL,        -- extracted from week_starts_on
  month                INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  hours                NUMERIC(8,2) NOT NULL,   -- 'total' column (hours, not days)
  state                TEXT NOT NULL,           -- Processed | Approved

  -- Resolved FKs
  allocation_entity_id TEXT REFERENCES allocation_entity(id),   -- via sn_programme_mapping
  initiative_id        TEXT REFERENCES initiative(id),           -- via sn_project_mapping (optional)
  resource_id          TEXT REFERENCES resource(id),             -- via name match (optional)

  import_warning       TEXT,   -- NULL = resolved; set only when allocation_entity unresolved
  created_at           TIMESTAMPTZ DEFAULT now()
);
```

**Note:** `initiative_id = NULL` is normal and not a warning. `allocation_entity_id = NULL` IS a warning
(programme not in `sn_programme_mapping`).

### 5.3 `sn_programme_mapping` (managed table, not an import)

```sql
CREATE TABLE sn_programme_mapping (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sn_programme_name    TEXT NOT NULL UNIQUE,
  allocation_entity_id TEXT REFERENCES allocation_entity(id),
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
```

### 5.4 `sn_project_mapping` (managed table, not an import)

```sql
CREATE TABLE sn_project_mapping (
  id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sn_project_nr     TEXT NOT NULL,
  sn_project_name   TEXT,
  initiative_id     TEXT REFERENCES initiative(id),
  year              INTEGER,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);
```

### 5.5 `invoice_import`

```sql
CREATE TABLE invoice_import (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  file_name   TEXT NOT NULL,
  year        INTEGER NOT NULL,
  imported_by TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  warn_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 5.6 `invoice_entry`

```sql
CREATE TABLE invoice_entry (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  import_id            TEXT NOT NULL REFERENCES invoice_import(id) ON DELETE CASCADE,

  -- Raw SAP VIM fields
  sap_vim_doc_id       TEXT NOT NULL,          -- ID doc VIM (col 2)
  sap_reservation_nr   TEXT,                   -- Réservat. (col 3) — engagement number
  sap_vendor_code      TEXT,                   -- Fourn. (col 4)
  vendor_name          TEXT,                   -- NomSt (col 5)
  eotp_full_path       TEXT NOT NULL,          -- Elément d'OTP raw (col 13)
  invoice_date         DATE NOT NULL,          -- Date doc. (col 10, DD/MM/YYYY)
  year                 INTEGER NOT NULL,
  month                INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount_eur           NUMERIC(12,2) NOT NULL, -- Montant (col 6, comma decimal)
  compte_budgetaire    TEXT NOT NULL,          -- 1211 | 1221

  -- Derived
  cost_type            TEXT NOT NULL DEFAULT 'EXTERNAL',
  -- NOTE: cost_type defaults to EXTERNAL for all VIM invoices.
  -- Compte budgétaire cannot reliably discriminate EXTERNAL vs DIRECT_COST.
  -- Store compte_budgetaire raw; cost_type can be overridden manually if needed.

  -- Resolved FK
  eotp_definition_id   TEXT REFERENCES eotp_definition(id),  -- via root EOTP extraction

  import_warning       TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);
```

### 5.7 `ar_import`

```sql
CREATE TABLE ar_import (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  file_name   TEXT NOT NULL,
  year        INTEGER NOT NULL,
  imported_by TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  warn_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 5.8 `ar_entry`

```sql
CREATE TABLE ar_entry (
  id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  import_id                TEXT NOT NULL REFERENCES ar_import(id) ON DELETE CASCADE,

  -- Raw SF fields — corrected export structure
  unique_ar_id             TEXT NOT NULL,            -- Unique AR ID (col 9): "00003410-00000011"
  contract_number          TEXT NOT NULL,            -- Contract Number (col 1): "00003410"
  contract_name            TEXT,                     -- Contract Name (col 2)
  counterpart_reference    TEXT,                     -- Counterpart reference (col 7): "AR-003410"
                                                     --   ← JOIN KEY to revenue_entry.ext_doc_ref
  line_item_number         TEXT NOT NULL,            -- Line Item Number (col 8)
  document_status          TEXT NOT NULL,            -- Signed | Approved
  signed_date              DATE,                     -- Signed Date (col 6, DD/MM/YYYY)
  client_name              TEXT,                     -- Account Name (col 0)

  -- Product fields
  sf_master_product_name   TEXT,                     -- Master Product Name (col 10): "_M-BackUp Online"
                                                     --   empty when no master product assigned
  sf_master_product_key    TEXT,                     -- Master Product Key / Jira key (future col)
                                                     --   NULL until SF adds this column
  sf_product_name          TEXT NOT NULL,            -- Product Name (col 11): sellable item
  description              TEXT,                     -- Description (col 12)
  sap_product_code         TEXT,                     -- SAP Product Code (col 17): 17072–17092
  sap_so_number            TEXT,                     -- SAP SO Number (col 18)
  wbs                      TEXT,                     -- WBS (col 16)
  end_date                 DATE,                     -- End Date (col 19, DD/MM/YYYY)

  quantity                 NUMERIC(12,2),            -- Quantity (col 13, comma decimal)
  amount_eur               NUMERIC(12,2) NOT NULL,   -- Total Price (col 15, comma decimal)
  year                     INTEGER NOT NULL,          -- passed at import time

  -- Resolved FK
  -- Current path: sf_master_product_name → sf_master_product_mapping → allocation_entity_id
  -- Future path:  sf_master_product_key  → allocation_entity.jiraKey  → allocation_entity_id
  allocation_entity_id     TEXT REFERENCES allocation_entity(id),

  import_warning           TEXT,
  created_at               TIMESTAMPTZ DEFAULT now(),

  -- UPSERT key: SF line item is unique per unique_ar_id + year
  UNIQUE (unique_ar_id, year)
);
```

### 5.9 `revenue_import`

```sql
CREATE TABLE revenue_import (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  file_name   TEXT NOT NULL,
  year        INTEGER NOT NULL,
  imported_by TEXT NOT NULL,
  row_count   INTEGER NOT NULL,
  warn_count  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

### 5.10a `sap_designation_mapping` (managed table — not an import)

Handles the case where `ext_doc_ref` is present but `Désignation poste` does not match
any SF `Product Name` in `ar_entry`. Managed in-app, populated manually as mismatches appear.

```sql
CREATE TABLE sap_designation_mapping (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sap_designation      TEXT NOT NULL UNIQUE,  -- Désignation poste value from SAP
  sf_product_name      TEXT,                  -- matching SF Product Name when known
  allocation_entity_id TEXT REFERENCES allocation_entity(id),  -- direct fallback if no AR match
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),
  updated_at           TIMESTAMPTZ DEFAULT now()
);
```

### 5.10 `revenue_entry`

```sql
CREATE TABLE revenue_entry (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  import_id            TEXT NOT NULL REFERENCES revenue_import(id) ON DELETE CASCADE,

  -- Raw SAP Client Invoice fields
  sap_doc_type         TEXT NOT NULL,            -- Type document vente (col 0): ZCS=invoice, ZCR=credit note
  sap_invoice_nr       TEXT NOT NULL,           -- Facture (col 41) ← invoice number
  sap_invoice_item     INTEGER NOT NULL,        -- Poste (col 48) ← invoice line item
                                                --   one (sap_invoice_nr, item) per Désignation poste / Article
  sap_doc_vente        TEXT,                    -- Document de vente (col 4) ← SAP Sales Order
  ext_doc_ref          TEXT,                    -- Numéro externe de document de vente (col 40)
                                                --   = AR Counterpart reference (e.g. AR-003410)
                                                --   empty for pre-SF-sync contracts
  client_name          TEXT,                    -- Nom (col 6)
  sap_article_code     TEXT,                    -- Article (col 20): 17072–17092
  designation          TEXT,                    -- Désignation poste (col 23) ← product label
                                                --   = SF Product Name for current contracts
  eotp_full            TEXT,                    -- Elément d'OTP (col 31): e.g. 8/R/B/0014/001
  year                 INTEGER NOT NULL,        -- Exercice comptable (col 58)
  month                INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount_eur           NUMERIC(12,2) NOT NULL,  -- Valeur nette (col 45)

  -- Resolved FKs
  ar_entry_id          TEXT REFERENCES ar_entry(id),         -- resolved via ext_doc_ref + designation
  allocation_entity_id TEXT REFERENCES allocation_entity(id), -- inherited from ar_entry OR via EOTP

  import_warning       TEXT,
  created_at           TIMESTAMPTZ DEFAULT now(),

  UNIQUE (sap_invoice_nr, year, sap_invoice_item)
);
```

> **UPSERT key — why three columns?** A single SAP `Facture` (e.g. `90836590`) can carry several
> `Poste` lines (item 10, 30, 40, 50…), each with its own `Désignation poste`, `Article` and
> `Valeur nette`. We store **one DB row per SAP invoice line item** so that AR↔SAP matching can
> happen at the product-line level (`(sales_order, designation)`), and so that aggregates like
> `v_realized_revenue` reflect the true number of invoiced lines, not collapsed invoice headers.

---

## 6. Views

### 6.1 `v_realized_costs`

```sql
CREATE OR REPLACE VIEW v_realized_costs AS

-- INTERNAL: timesheets → cost via daily rate
SELECT
  te.year,
  te.month,
  'INTERNAL'                              AS cost_type,
  te.allocation_entity_id,
  ae.name                                 AS product_name,
  ae.sap_eotp_code                        AS eotp,
  NULL::text                              AS division,
  NULL::text                              AS sub_division,
  NULL::text                              AS team,
  NULL::text                              AS owner,
  te.initiative_id,
  te.resource_id,
  te.sn_programme_name,
  te.sn_project_nr,
  te.sn_project_label,
  -- cost = (hours / 8) × effective daily rate
  (te.hours / 8.0) * COALESCE(r.daily_rate, rs.daily_rate) AS amount_eur,
  te.hours,
  te.import_warning
FROM timesheet_entry te
LEFT JOIN allocation_entity ae  ON ae.id = te.allocation_entity_id
LEFT JOIN rate r                ON r.resource_id = te.resource_id AND r.year = te.year
LEFT JOIN rate_standard rs      ON rs.type = 'INTERNAL' AND rs.year = te.year

UNION ALL

-- EXTERNAL + DIRECT_COST: SAP VIM invoices → joined to eotp_definition for ownership
SELECT
  ie.year,
  ie.month,
  ie.cost_type,
  NULL::text                              AS allocation_entity_id,
  NULL::text                              AS product_name,
  ie.eotp_full_path                       AS eotp,
  ed.division,
  ed.sub_division,
  ed.team,
  ed.owner,
  NULL::text                              AS initiative_id,
  NULL::text                              AS resource_id,
  NULL::text                              AS sn_programme_name,
  NULL::text                              AS sn_project_nr,
  ie.vendor_name                          AS sn_project_label,
  ie.amount_eur,
  NULL::numeric                           AS hours,
  ie.import_warning
FROM invoice_entry ie
LEFT JOIN eotp_definition ed ON ed.id = ie.eotp_definition_id
```

### 6.2 `v_planned_revenue`

```sql
CREATE OR REPLACE VIEW v_planned_revenue AS
SELECT
  ar.year,
  ar.allocation_entity_id,
  ae.name                                 AS product_name,
  ae.sap_eotp_code                        AS eotp,
  ar.activity_sector,
  ar.sf_product_name,
  ar.client_name,
  SUM(ar.amount_eur)                      AS amount_eur,
  COUNT(*)                                AS line_count
FROM ar_entry ar
LEFT JOIN allocation_entity ae ON ae.id = ar.allocation_entity_id
GROUP BY ar.year, ar.allocation_entity_id, ae.name, ae.sap_eotp_code,
         ar.activity_sector, ar.sf_product_name, ar.client_name
```

### 6.3 `v_realized_revenue`

```sql
CREATE OR REPLACE VIEW v_realized_revenue AS
SELECT
  re.year,
  re.month,
  re.allocation_entity_id,
  ae.name                                 AS product_name,
  ae.sap_eotp_code                        AS eotp,
  re.designation,                         -- Désignation poste = SF Product Name
  re.client_name,
  re.sap_doc_vente,
  re.ext_doc_ref,                         -- AR counterpart reference (e.g. AR-003410)
  re.ar_entry_id,
  ar.counterpart_reference                AS ar_ref,
  ar.sf_product_name                      AS ar_product_name,
  ar.unique_ar_id,
  SUM(re.amount_eur)                      AS amount_eur,
  COUNT(*)                                AS invoice_count
FROM revenue_entry re
LEFT JOIN allocation_entity ae ON ae.id = re.allocation_entity_id
LEFT JOIN ar_entry ar          ON ar.id = re.ar_entry_id
GROUP BY
  re.year, re.month, re.allocation_entity_id, ae.name, ae.sap_eotp_code,
  re.designation, re.client_name, re.sap_doc_vente, re.ext_doc_ref,
  re.ar_entry_id, ar.counterpart_reference, ar.sf_product_name, ar.unique_ar_id
```

---

## 7. Parsers

### 7.1 `src/lib/sn-timesheet-parser.ts`

Handles both CSV rows and API response records — both produce `TimesheetRow[]`.

```
Filter rows: category === 'Project/Project Task' AND state IN ['Processed', 'Approved']

For each row:
  1. Parse week_starts_on (DD/MM/YYYY) → Date → extract year, month
  2. Store hours as-is (total column)

  Programme → allocation_entity resolution (EOTP-first):
  a) If row.top_task.top_program_eotp is present and non-empty:
       → look up eotp_definition by eotp code
       → resolve allocation_entity via allocation_entity.sapEotpCode match
       → no warning
  b) Else:
       → look up sn_programme_mapping by sn_programme_name
       → if found → allocation_entity_id from mapping
       → if not found → allocation_entity_id = NULL
                      + import_warning = 'Programme not mapped: {name}'

  3. Look up sn_project_nr in sn_project_mapping → initiative_id (optional, no warning if absent)
  4. Look up user name in resource table → resource_id (optional, no warning)
```

**API mode** (`SN_IMPORT_MODE = 'api'`):
Instead of parsing a file, `src/lib/sn-client.ts` fetches from the ITBM REST API,
maps the JSON fields to the same `TimesheetRow` type, then passes to the same parser logic.
The import record uses `file_name = 'api-sync-{year}-{timestamp}'` for traceability.

### 7.2 `src/lib/sap-invoice-parser.ts`

Input: `SAP_VIM_Factures_Fournisseurs.csv` (semicolon-delimited)

```
Filter rows:
  - Descr. (col 0) === 'Approbation terminée'    (skip 'Annulé')
  - Compte budgét. (col 9) !== 'T_GRIR'           (skip accruals)
  - Compte budgét. (col 9) is not empty

For each row:
  1. Parse Date doc. (col 10, DD/MM/YYYY) → year, month
  2. Parse Montant (col 6): replace comma with dot → float  (e.g. '7821,45' → 7821.45)
  3. Store compte_budgetaire (col 9) raw for traceability
  4. cost_type = 'EXTERNAL' (default — cannot be reliably derived from compte_budgetaire)
  5. Clean EOTP: strip trailing comma/space from col 13
  6. Extract root EOTP: split on '/', take first 3 parts, rejoin
     e.g. '7/D/0056/001.02.02' → '7/D/0056'
  7. Look up root in eotp_definition.eotp → eotp_definition_id
     If not found → eotp_definition_id = NULL, import_warning = 'EOTP not found: {root}'
```

### 7.3 `src/lib/sf-ar-parser.ts`

Handles both CSV rows and Salesforce API records — both produce `ArLineItem[]`.

**CSV pre-processing:** strip outer quote from each line, split on `;`,
strip inner double-quotes from each field.

```
Filter rows: Document Status IN ['Signed', 'Approved']
Skip: Draft, Presented, Cancelled

For each row:
  1. Read unique_ar_id (col 9), contract_number (col 1), line_item_number (col 8)
  2. Read sf_master_product_name (col 10) — may be empty
  3. Check for future Jira key field:
     CSV: scan header for 'Price Book Entry: Product: Master Product: Product Key'
     API: check for field PricebookEntry.Product2.ProductCode
     If present and non-empty for this row → sf_master_product_key = that value
     Else sf_master_product_key = NULL
  4. Read sf_product_name (col 11), description (col 12)
  5. Parse Total Price (col 15): replace ',' with '.' → float
  6. year = passed as import parameter (CSV mode) or query parameter (API mode)

  Master Product → allocation_entity resolution (Jira key-first):
  a) If sf_master_product_key is non-null:
       → look up allocation_entity by jiraKey directly
       → no mapping table needed
  b) Else if sf_master_product_name is non-empty:
       → look up sf_master_product_mapping by sf_master_product_name
       → resolve to allocation_entity_id
  c) Else:
       → allocation_entity_id = NULL
       → import_warning = 'No master product name or key — cannot resolve product'

  7. UPSERT on (unique_ar_id, year)
```

**API mode** (`SF_IMPORT_MODE = 'api'`):
`src/lib/sf-client.ts` fetches from SF REST API using OAuth token, maps JSON fields to
`ArLineItem[]`, then passes to the same parser logic above.
`file_name = 'api-sync-{year}-{timestamp}'` on the `ar_import` record.

**Token management in `src/lib/sf-client.ts`:**
```typescript
// POST {SF_INSTANCE_URL}/services/oauth2/token
// grant_type=client_credentials
// client_id={SF_CLIENT_ID}&client_secret={SF_CLIENT_SECRET}
// Cache token in memory; refresh on 401
```

### 7.4 SAP client revenue — parse (`src/lib/sap-revenue-parser.ts`) + resolve (`src/lib/revenue-import-resolve.ts`)

Input: `SAP_Clients_Invoices.csv` (semicolon-delimited, 68 columns). The parser reads columns and normalises amounts/dates; **product / AR resolution** is implemented in **`revenue-import-resolve.ts`** (called once per logical row during import).

```
Filter rows: Facture (col 41) is not empty (skip uninvoiced order lines)

For each row:
  1. Read sap_doc_type (col 0): 'ZCS' = normal invoice, 'ZCR' = credit note (reimbursement)
  2. Read sap_invoice_nr (col 41)
  2a. Read sap_invoice_item (col 48)  ← Poste, line item within the invoice
  3. Read sap_doc_vente (col 4)  ← SAP sales order / document de vente
  4. Read ext_doc_ref (col 40)  ← AR counterpart reference, may be empty
  5. Read designation (col 23)  ← Désignation poste = SF Product Name for current contracts
  6. Read eotp_full (col 31), sap_article_code (col 20), client_name (col 6)
  7. year = Exercice comptable (col 58)
  8. month = from Date de la pièce (col 59) — DD/MM/YYYY or Excel 1900 serial when exported as integer
  9. Parse Valeur nette (col 45): remove '.' (thousands), replace ',' → '.' → float
     e.g. '33.260,48' → 33260.48
     If sap_doc_type = 'ZCR' → amount_eur = parsed_value * -1  (store as negative)
     If sap_doc_type = 'ZCS' → amount_eur = parsed_value (store as positive)

  Resolution (4 steps, in priority order) — `resolveRevenueEntry`:

  STEP 1 — AR line item match (current contracts, best case)
  If ext_doc_ref AND designation are both non-empty:
    look up ar_entry WHERE counterpart_reference = ext_doc_ref
                      AND sf_product_name        = designation
    If found:
      → ar_entry_id = ar_entry.id
      → allocation_entity_id = ar_entry.allocation_entity_id
      → no warning
    If NOT found → go to STEP 2

  STEP 2 — Only when ext_doc_ref is non-empty (AR contract context, but step 1 missed)
  If designation is non-empty:
    look up sap_designation_mapping WHERE sap_designation = designation
    If mapping found AND mapping.sf_product_name is non-empty:
      look up ar_entry WHERE counterpart_reference = ext_doc_ref
                        AND sf_product_name        = mapping.sf_product_name
      If AR found:
        → ar_entry_id = ar_entry.id
        → allocation_entity_id = ar_entry.allocation_entity_id
        → no warning (same outcome as STEP 1)
      Else:
        → allocation_entity_id from mapping (may be NULL)
        → ar_entry_id = NULL
        → import_warning (mapped SF product name has no AR line on this contract)
    Else if mapping found (allocation only, or no sf_product_name):
      → allocation_entity_id from mapping (may be NULL)
      → ar_entry_id = NULL
      → import_warning as appropriate
  If mapping not found OR designation empty:
      → allocation_entity_id = NULL, ar_entry_id = NULL
      → import_warning (designation / AR mismatch)
  **Important:** when ext_doc_ref is present, resolution **stops here** — there is **no** EOTP fallback
  in step 3 for those rows (avoids silently attributing AR-tagged invoices to the wrong product).

  STEP 3 — EOTP fallback (pre-SF contracts — only when ext_doc_ref is empty)
  extract root EOTP from eotp_full (see `extractEotpRoot` — same family of rules as VIM / design §3.6)
  look up eotp_definition by sap_eotp_code, then allocation_entity via eotp_definition_id or sapEotpCode match
  If found:
      → allocation_entity_id from EOTP path
      → ar_entry_id = NULL
      → no warning
  If NOT found → go to STEP 4

  STEP 4 — Unresolved
  → allocation_entity_id = NULL
  → ar_entry_id = NULL
  → import_warning = 'Cannot resolve product: ext_doc_ref={ext_doc_ref} designation={designation} eotp={eotp_full}'

  10. UPSERT on (sap_invoice_nr, year, sap_invoice_item)
```

---

## 8. API Routes

```
--- CSV import routes (always available) ---
POST   /api/imports/timesheets         multipart: file + year
GET    /api/imports/timesheets         list imports with warn_count
DELETE /api/imports/timesheets/[id]    cascade deletes entries

POST   /api/imports/invoices
GET    /api/imports/invoices
DELETE /api/imports/invoices/[id]

POST   /api/imports/ar
GET    /api/imports/ar
DELETE /api/imports/ar/[id]

POST   /api/imports/revenue
GET    /api/imports/revenue
DELETE /api/imports/revenue/[id]

--- API sync routes (activated when keys are available) ---
POST   /api/imports/timesheets/sync    triggers SN API fetch for a given year
       body: { year: number }
       requires SN_IMPORT_MODE=api + SN_CLIENT_ID + SN_CLIENT_SECRET in env

POST   /api/imports/ar/sync            triggers SF API fetch for a given year
       body: { year: number }
       requires SF_IMPORT_MODE=api + SF_CLIENT_ID + SF_CLIENT_SECRET + SF_INSTANCE_URL in env

--- Report routes ---
GET    /api/reports/realized-costs
  ?year=2025 &month? &division? &subdivision? &team? &owner? &productId?

GET    /api/reports/revenue
  ?year=2025 &productId? &month?

--- Mapping management ---
GET    /api/mappings/sn-programmes
POST   /api/mappings/sn-programmes
DELETE /api/mappings/sn-programmes/[id]

GET    /api/mappings/sn-projects
POST   /api/mappings/sn-projects
DELETE /api/mappings/sn-projects/[id]

GET    /api/mappings/sf-products
POST   /api/mappings/sf-products
DELETE /api/mappings/sf-products/[id]

GET    /api/mappings/sap-designations
POST   /api/mappings/sap-designations
DELETE /api/mappings/sap-designations/[id]
```

---

## 9. Report Layout (Forecasts vs Actuals — "Nouvelle version")

The report mirrors the CRPS "Nouvelle version" structure: **per EOTP/Product**, comparing
forecasted costs against actuals sourced purely from SAP + SN.

```
[ Planning vs Baseline ]  [ Realized Costs ]  [ Revenue ]
```

**Tab: Realized Costs**
- Toolbar: Year · Month (All or specific) · Division → Subdivision → Team → Owner
- KPI cards: Total Internal · Total External · Total Direct · Grand Total
- Table: per EOTP · product name · Internal (SN) · External (VIM 1211) · Direct (VIM 1221) · Total
- Comparison column: Planned Catchout from snapshot (optional, when snapshot selected)

**Tab: Revenue**
- Toolbar: Year · Month (All or specific) · Product
- KPI cards: Planned AR (Salesforce) · Realized (SAP invoiced) · Gap · Coverage %
- Table: per Product/EOTP · Planned AR · Realized · Gap · Coverage %
- Sub-rows: per client (`client_name`) for drill-down

---

## 10. Mapping Management UI

New page `/imports/mappings` with three cards:

**SN Programme Mapping**
- Table: SN Programme Name | EOTP Code | Linked Product (`allocation_entity`) | Notes | Actions
- `EOTP Code` column is read-only — populated automatically when SN starts carrying the EOTP on the Programme record
- Rows with an EOTP set show a green **"EOTP-resolved"** badge — direct resolution will work without the name lookup
- Rows with only a name (no EOTP) remain the active fallback — must be kept up to date
- Add row: free-text programme name + product picker
- Pre-populate from the Excel `(SN) Mapping > Program Mapping` tab

**SN Project Mapping**
- Table: SN Project Nr | Project Name | Linked Initiative | Year | Actions
- Add row: project number + initiative picker + optional year scope
- Pre-populate from the Excel `(SN) Mapping > Project Mapping` tab

**Salesforce Master Product Mapping**
- Table: SF Master Product Name | Jira Key (future, read-only) | Linked Product (`allocation_entity`) | Notes | Actions
- `Jira Key` column shown as read-only — populated automatically when SF exports `Master Product Key`
- When a Jira key is present, row shows a green **"Jira-resolved"** badge — direct resolution active, mapping table kept as fallback
- Add row: master product name (e.g. `_M-BackUp Online`) + product picker
- Pre-populate from the distinct `Master Product Name` values seen after first AR import

**SAP Designation Mapping** *(fallback for step 2 mismatches)*
- Table: SAP Désignation poste | SF Product Name | Linked Product (`allocation_entity`) | Notes | Actions
- Populated reactively — rows appear here when `import_warning` is set on a `revenue_entry` with a non-empty `ext_doc_ref` that didn't match any AR line item
- The import UI surfaces these warnings with a "Fix mapping →" link that pre-fills the designation value in this table
- Add row: paste the exact SAP designation + pick the matching `allocation_entity`

All four tables are editable in-app. No import needed.

---

## 10b. Import / Sync UI

New page `/imports` with four source cards.

Each card shows:
- Import history list (date · source · rows · warnings)
- **If `_IMPORT_MODE = 'csv'`**: file upload button + year selector → POST → result summary with warnings
- **If `_IMPORT_MODE = 'api'`**: "Sync from [Source]" button + year selector → POST `/sync` → result summary
- Delete per import row (shadcn Dialog confirmation → cascade deletes entries)

**ServiceNow card** — shows current mode. When API mode active, shows last sync timestamp + OAuth status indicator.
**Salesforce card** — shows current mode. When API mode active, shows last sync timestamp + OAuth status indicator.
**SAP Invoices card** — always CSV mode. No API planned.
**SAP Revenue card** — always CSV mode. No API planned.

Add `/imports` and `/imports/mappings` to sidebar nav under **"Données réalisées"**.

---

## 11. Implementation Steps

### Step 1 — Mapping tables + schema migration

**Files:** `prisma/migrations/YYYYMMDD_realized/migration.sql`, `prisma/schema.prisma`

Create: `sn_programme_mapping`, `sn_project_mapping`, `sf_master_product_mapping`,
`sap_designation_mapping`, `timesheet_import`, `timesheet_entry`, `invoice_import`,
`invoice_entry`, `ar_import`, `ar_entry`, `revenue_import`, `revenue_entry`.

```bash
npx prisma migrate dev --name realized_costs
npx prisma studio   # verify all 12 new tables
```

### Step 2 — Views

**Files:** `scripts/realized-views.ts`, register in `seed-production.ts`

```bash
SEED_VIEW_ONLY=1 npm run db:seed:prod
# SELECT * FROM v_realized_costs LIMIT 1;   → empty, no error
# SELECT * FROM v_planned_revenue LIMIT 1;   → empty, no error
# SELECT * FROM v_realized_revenue LIMIT 1;  → empty, no error
```

### Step 3 — Mapping APIs + UI

**Files:** `src/app/api/mappings/sn-programmes/route.ts`, `src/app/api/mappings/sn-projects/route.ts`,
`src/app/api/mappings/sf-products/route.ts`, `src/app/imports/mappings/page.tsx`

Three managed mapping tables with CRUD APIs. The UI page shows all three cards.
Before proceeding to Step 4, seed at minimum:
- SN Programme → Product mappings from Excel `(SN) Mapping > Program Mapping`
- SF Master Product → allocation_entity mappings (from known AR product list)

### Step 4 — SN Timesheet parser + import API

**Files:** `src/lib/sn-timesheet-parser.ts`, `src/app/api/imports/timesheets/route.ts`

```bash
curl -F "file=@SN_Time_Card_Export_2025.csv" -F "year=2025" \
  http://localhost:3000/api/imports/timesheets
# Expected: ~45776 total rows → ~6 Project/Task rows imported
# (small number confirms only Project/Project Task category is imported)
# Check warn_count: should be 0 if programme mapping is seeded
```

### Step 5 — SAP Invoice parser + import API

**Files:** `src/lib/sap-invoice-parser.ts`, `src/app/api/imports/invoices/route.ts`

```bash
curl -F "file=@SAP_VIM_Factures_Fournisseurs.csv" -F "year=2025" \
  http://localhost:3000/api/imports/invoices
# Expected: 8 rows imported (Approbation terminée, excluding T_GRIR and Annulé)
# All imported rows have cost_type = 'EXTERNAL' (default)
# Check v_realized_costs returns EXTERNAL rows with EOTP and ownership columns
```

### Step 6 — Salesforce AR parser + import API

**Files:** `src/lib/sf-ar-parser.ts`, `src/app/api/imports/ar/route.ts`

```bash
curl -F "file=@SalesForce_AR_export.csv" -F "year=2025" \
  http://localhost:3000/api/imports/ar
# Re-upload → row count unchanged (UPSERT on unique_ar_id + year)
# Check v_planned_revenue returns totals per product
# Check warn_count: rows where Master Product Name is empty or unmapped will warn
```

### Step 7 — SAP Revenue parser + import API

**Files:** `src/lib/sap-revenue-parser.ts`, `src/app/api/imports/revenue/route.ts`

```bash
curl -F "file=@SAP_Clients_Invoices.csv" -F "year=2025" \
  http://localhost:3000/api/imports/revenue
# Only rows where Facture (col 41) is non-empty are imported
# Check resolution breakdown in response:
#   step1_count: resolved via AR line item match (ext_doc_ref + designation)
#   step2_count: resolved via sap_designation_mapping (with warning)
#   step3_count: resolved via EOTP fallback (pre-SF contracts, no warning)
#   step4_count: fully unresolved (warning)
# Check v_realized_revenue: rows with ar_entry_id set show full AR chain
# Check v_realized_revenue: rows without ar_entry_id show EOTP-only resolution
```

### Step 8 — Report API routes

**Files:** `src/app/api/reports/realized-costs/route.ts`, `src/app/api/reports/revenue/route.ts`

```bash
curl "http://localhost:3000/api/reports/realized-costs?year=2025"
curl "http://localhost:3000/api/reports/revenue?year=2025"
```

### Step 9 — Import UI + mapping UI

**Files:** `src/app/imports/page.tsx`, `src/app/imports/mappings/page.tsx`

Four import cards + three mapping cards. Both pages added to sidebar nav under "Données réalisées".
The import cards detect `SN_IMPORT_MODE` and `SF_IMPORT_MODE` from env and render
file-upload or sync-button accordingly.

### Step 10a — ServiceNow API client (activate when keys received)

**Files:** `src/lib/sn-client.ts`, `src/app/api/imports/timesheets/sync/route.ts`

```typescript
// src/lib/sn-client.ts
// GET {SN_INSTANCE_URL}/api/now/table/pm_project_task_time_card
// Headers: Authorization: Bearer {token}
// OAuth: client_credentials via POST /oauth_token.do
// Returns: JSON array → mapped to TimesheetRow[] → same parser as CSV
```

```bash
# Test once SN_IMPORT_MODE=api + credentials are set:
curl -X POST http://localhost:3000/api/imports/timesheets/sync \
  -H "Content-Type: application/json" \
  -d '{"year": 2025}'
# Expected: same row counts as CSV import
```

### Step 10b — Salesforce API client (activate when keys received)

**Files:** `src/lib/sf-client.ts`, `src/app/api/imports/ar/sync/route.ts`

```typescript
// src/lib/sf-client.ts
// POST {SF_INSTANCE_URL}/services/oauth2/token → access_token
// GET {SF_INSTANCE_URL}/services/data/v60.0/query?q={SOQL}
// Returns: JSON records → mapped to ArLineItem[] → same parser as CSV
```

```bash
# Test once SF_IMPORT_MODE=api + credentials are set:
curl -X POST http://localhost:3000/api/imports/ar/sync \
  -H "Content-Type: application/json" \
  -d '{"year": 2025}'
# Expected: same row counts and UPSERT behaviour as CSV import
```

### Step 11 — Report tabs

**Files:** extend `src/app/reports/comparison/ComparisonClient.tsx` with two new tabs.

---

## 13. Constraints and Conventions

- All raw SQL via `Prisma.sql` tagged templates — never string concatenation.
- **SN Programme resolution priority:** EOTP code (when SN provides it) → `sn_programme_mapping` name fallback → NULL + warning. The mapping table is permanent as a fallback, never removed.
- **SF Master Product resolution priority:** Jira key (when SF provides it) → `sf_master_product_mapping` name fallback → NULL + warning. Same pattern as SN.
- **API vs CSV:** controlled by `SN_IMPORT_MODE` and `SF_IMPORT_MODE` env vars (`'api' | 'csv'`). Schema and parser logic are identical for both modes — only the data ingestion step differs. Default = `'csv'` until API keys are live.
- `cost_type` stored as `TEXT`, no CHECK constraint for VIM rows — defaults to `'EXTERNAL'`.
- VIM filter: skip `Descr. = 'Annulé'` and `Compte budgét. = 'T_GRIR'`. All other `Approbation terminée` rows are imported regardless of `Compte budgét.` value.
- `Compte budgét.` stored raw on `invoice_entry` for traceability but NOT used to determine cost type.
- SF AR filter: import `Signed` and `Approved` only. Skip `Draft`, `Presented`, `Cancelled`.
- `sf_master_product_key` stored on `ar_entry` and `sf_master_product_mapping` — ready for when SF exports the Jira key.
- `initiative_id = NULL` on `timesheet_entry` is valid — not a warning.
- `allocation_entity_id = NULL` IS a warning — programme/product not in mapping table.
- UPSERT on `(unique_ar_id, year)` for AR and `(sap_invoice_nr, year, sap_invoice_item)` for revenue.
  The triple key keeps every SAP invoice **line item** (`Poste`) as its own row — multiple `Désignation poste` lines under one `Facture` are no longer collapsed.
- **Revenue resolution priority (4 steps):**
  1. `ext_doc_ref` + `designation` match `ar_entry` → `ar_entry_id` set, `allocation_entity_id` inherited — no warning
  2. `ext_doc_ref` present, step 1 miss → `sap_designation_mapping`; if **`sf_product_name`** is set, retry AR match with ref + that name (same as 1); on success → `ar_entry_id` + inherited allocation, no warning; else mapping’s `allocation_entity_id` only + warning
  3. `ext_doc_ref` empty (pre-SF contract) → EOTP root from `col[31]` → `allocation_entity` — no warning
  4. Nothing resolves → `allocation_entity_id = NULL` + warning
- `revenue_entry.ext_doc_ref` = SAP `col[40]` Numéro externe de document de vente = AR `counterpart_reference`
- `revenue_entry.designation` = SAP `col[23]` Désignation poste = SF `Product Name` for current contracts
- `sap_designation_mapping` is populated reactively from import warnings — not pre-seeded
- **`revenue_entry.ar_entry_id` is year-agnostic.** A SAP invoice booked in calendar year *Y* may legitimately link to an AR contract from *Y±1* (multi-year contracts, late billing). Downstream joins on `(revenue_entry, ar_entry)` MUST NOT predicate on `re.year = ar.year` when matching by FK; the year predicate is only valid for the legacy `(sap_so_number, sf_product_name)` heuristic fallback (when `ar_entry_id IS NULL`).
- **ZCR credit notes:** `Type document vente = 'ZCR'` → `amount_eur` stored as negative. `ZCS` = positive. No filtering — both types are imported and the sign handles the accounting.
- Amount parsing: VIM uses `7821,45` (comma decimal). SF AR uses `3663,00` (comma decimal). Client invoices use `33.260,48` (dot thousands + comma decimal). Each parser handles its own format.
- EOTP root extraction: first 3 slash-segments for both `7/D/XXXX` and `8/R/X/XXXX` formats.
- `ON DELETE CASCADE` on all `import_id` FKs.
- `dynamic = "force-dynamic"` on all report pages.
- Never modify `v_allocation_costs`, `v_eotp_costs`, or any existing views.
- The `SAP_Reservation_Credits.csv` and `SAP_CAD_Export_YYYY.csv` files are NOT imported into the realized layer. They represent commitments/budget, already covered by BudgetBaseline.
