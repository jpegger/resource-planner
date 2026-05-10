# Resource Planner — Full Data Model
## All layers: Planning · EOTP Routing · Snapshots · Baselines · Realized Costs · Revenue
## v2.2 — revenue_entry per SAP invoice line item (sap_invoice_item / Poste, col 48)
##         unique key now (sap_invoice_nr, year, sap_invoice_item)
## v2.1 — adds revenue_entry AR link (sap_doc_type, ext_doc_ref, ar_entry_id)
##         + sap_designation_mapping + 4-step resolver + ZCR sign + Excel-serial dates
##         (see CONTEXT.md §4.14)

---

## 1. Core Planning Layer

```
                         RESOURCES

   [Resource: INTERNAL]    [Resource: EXTERNAL]    [Resource: DIRECT_COST]
   fullName, direction      fullName, cellule        fullName (licence, hosting…)
   type = INTERNAL          type = EXTERNAL          type = DIRECT_COST
          |                        |                        |
          v                        v                        v
   [Rate]                   [Rate]                   [Rate]
   resourceId + year         resourceId + year         resourceId + year
   dailyRate (EUR/day)       dailyRate (EUR/day)       dailyRate (unit price)
   nbrDaysPerYear = 200      nbrDaysPerYear = 220      nbrDaysPerYear = 1.0
          |                        |                        |
          +------------------------+------------------------+
                                   |
                                   v
                            [RateStandard]
                           type + year (fallback for dailyRate only —
                           nbrDaysPerYear NEVER falls back here)
```

---

## 2. Product → Initiative → Allocation

```
                    [AllocationEntity]  (table: allocation_entity)
                    id
                    name                     (= Jira component name)
                    jiraKey                  (= Jira component key, e.g. NOVA)
                    sapEotpCode              ← main SAP EOTP (e.g. 7/D/0024)
                    sapEotpName
                    productFamily / division / subDivision / team
                    attractiveness / competitiveness
                           |
                    1      |      N
                           v
                    [Initiative]
                    id  (RI-xxx Jira key)
                    summary, year, status
                    initiativeType (Run | Evolution | Rollout …)
                    productGroup
                    allocationEntityId → FK AllocationEntity (optional)
                           |
               +-----------+------------+
               |                        |
               v                        v
        [Allocation]              [InitiativeRevenue]
        resourceId → Resource     type: Mission | Subscription
        initiativeId → Initiative amount (EUR)
        quantity (FTE %)          comment
        manDays (man-days)
        (mutually exclusive;
         manDays takes priority)
```

---

## 3. Cost Calculation (never stored, computed in views)

```
   [Allocation] + [Rate] + [RateStandard]
           |
           v
   ┌──────────────────────────────────────────────────────────┐
   │  INTERNAL / EXTERNAL                                     │
   │    if manDays > 0:  cost = manDays × effective_rate      │
   │    if quantity > 0: cost = quantity × nbrDaysPerYear      │
   │                           × effective_rate               │
   │  DIRECT_COST                                             │
   │    cost = quantity × Rate.dailyRate                      │
   │                                                          │
   │  effective_rate = Rate.dailyRate                         │
   │               ?? RateStandard.dailyRate (type + year)    │
   └──────────────────────────────────────────────────────────┘
           |
           v
   [v_allocation_costs]  (PostgreSQL view — read only)
   internal_cost / external_cost / direct_cost / computed_cost
   fte_decimal / fte_percent / calculated_man_days
   product_name / sap_eotp_code / division … (all dims denormalised)
```

---

## 4. EOTP Routing Layer

```
                    [AllocationEntity]
                    sapEotpCode = "7/D/0024"   ← MAIN EOTP (remainder bucket)
                           |
                     budget split
                           |
           +---------------+-------------------+
           |                                   |
           v                                   v
   [EotpRouting]  (exception rows only)   [Main EOTP remainder]
   allocationEntityId → AllocationEntity   (not stored — computed)
   eotp = "7/D/0020"  (≠ sapEotpCode)
   eotpDefinitionId → EotpDefinition (optional)
   year
   internalAmount / externalAmount / directAmount
           |
           v
   [EotpDefinition]  (catalog — table: eotp_definition)
   eotp (SAP root code, e.g. 7/D/0024)     ← Level-1 from SAP_OTP_Level1.csv
   label
   division / sub_division / team / owner   ← ownership navigation
           |
           v
   [v_eotp_costs]  (PostgreSQL view)
   One row per product × year × eotp:
     exception rows   → amounts from EotpRouting
     main EOTP row    → total minus all exceptions
   + cash_out = external + direct
   + is_main_eotp flag

   RULE: EotpRouting.eotp must NEVER equal AllocationEntity.sapEotpCode
```

---

## 5. Snapshot & Baseline Layer

```
   [AllocationSnapshot]
   id, name, year, takenBy, createdAt
           |
           v
   [AllocationSnapshotRow]
   snapshotId / eotp / year
   internalAmount / externalAmount / directAmount
   catchout = externalAmount + directAmount
           |
           v
   [v_snapshot_detail]  (view)


   [BudgetBaseline]
   id, name, version, year, importedBy, createdAt
   Source: SAP_CAD_Export_YYYY.csv (FMAVCH01 transaction)
           + SAP_Reservation_Credits.csv (S_P99_41000147)
   NOTE: These SAP files are BUDGET/COMMITMENT data, not realized costs.
         They feed the baseline comparison only.
           |
           v
   [BudgetBaselineRow]
   baselineId / eotp / year / amount (EUR, negated on import)
           |
           v
   [v_baseline_detail]


   [v_comparison]  =  eotp_definition
                      LEFT JOIN v_snapshot_detail   (planned catchout)
                      LEFT JOIN v_baseline_detail   (SAP budget)
   gap = baseline_amount − catchout
   Navigable by: division → sub_division → team → owner → eotp
```

---

## 6. ServiceNow Timesheet Layer (Realized Internal Costs)

```
   SAP/SN EXPORT FILES
   SN_Time_Card_Export_YYYY.csv   (SN Platform Analytics report, per year)
   ITBM_pm_project.csv            (SN project list — used for reference/mapping)
   ITBM_pm_project_task.csv       (SN task list — used for reference)

   CSV COLUMNS USED:
   user                    → sn_user (full name)
   top_task.top_program    → sn_programme_name (e.g. "Production & Delivery Support")
   top_task.top_task       → sn_project_nr (e.g. PRJ0010754)
   top_task.short_description → sn_project_label
   task                    → sn_task_nr
   task.short_description  → sn_task_label
   week_starts_on          → DD/MM/YYYY → year + month
   total                   → hours (divide by 8 for man-days at cost compute time)
   category                → FILTER: keep 'Project/Project Task' only
   state                   → FILTER: keep 'Processed' and 'Approved' only

           |
           v  CSV import
   [timesheet_import]    audit header
           |
           v  ON DELETE CASCADE
   [timesheet_entry]
   sn_user / sn_programme_name / sn_project_nr / sn_project_label
   sn_task_nr / sn_task_label / week_starts_on / year / month / hours / state
   allocation_entity_id → AllocationEntity   (via sn_programme_mapping)
   initiative_id        → Initiative          (via sn_project_mapping, optional)
   resource_id          → Resource            (via name match, optional)
   import_warning       → set only when programme not in sn_programme_mapping


   MANAGED MAPPING TABLES (not imports — edited in-app UI):

   [sn_programme_mapping]
   sn_programme_name (UNIQUE)  ←──── e.g. "Production & Delivery Support"
   allocation_entity_id ──────────►  AllocationEntity
   Pre-populated from Excel "(SN) Mapping > Program Mapping" tab

   [sn_project_mapping]
   sn_project_nr  (e.g. PRJ0010754)
   initiative_id ─────────────────►  Initiative (optional)
   year (optional scope)
   Pre-populated from Excel "(SN) Mapping > Project Mapping" tab


   RESOLUTION PATH:
   sn_programme_name
        → sn_programme_mapping.sn_programme_name
        → allocation_entity_id  (required — warning if absent)

   sn_project_nr
        → sn_project_mapping.sn_project_nr
        → initiative_id  (optional — NULL is valid, no warning)

   COST COMPUTATION (in v_realized_costs view):
   amount_eur = (hours / 8.0) × COALESCE(Rate.dailyRate, RateStandard.dailyRate)
```

---

## 7. SAP VIM Supplier Invoices Layer (Realized External + Direct Costs)

```
   SAP EXPORT FILE
   SAP_VIM_Factures_Fournisseurs.csv   (ZVIM_ANA_DETAIL, périmètre 1700)

   CSV COLUMNS (semicolon-delimited):
   col 0  Descr.           → FILTER: keep 'Approbation terminée', skip 'Annulé'
   col 2  ID doc VIM       → sap_vim_doc_id (invoice identifier)
   col 3  Réservat.        → sap_reservation_nr (engagement/commitment number)
   col 4  Fourn.           → sap_vendor_code
   col 5  NomSt            → vendor_name
   col 6  Montant          → amount_eur (comma decimal: "7821,45" → 7821.45)
   col 9  Compte budgét.   → cost_type mapping:
                              1211  → EXTERNAL
                              1221  → DIRECT_COST
                              T_GRIR → SKIP (accrual, not final invoice)
                              empty  → SKIP
   col 10 Date doc.        → invoice_date (DD/MM/YYYY) → year + month
   col 13 Elément d'OTP    → eotp_full_path (e.g. "7/D/0056/001.02.02,")
                              strip trailing comma/space
                              extract root: first 3 segments → "7/D/0056"
                              match against eotp_definition.eotp

           |
           v  CSV import
   [invoice_import]    audit header
           |
           v  ON DELETE CASCADE
   [invoice_entry]
   sap_vim_doc_id / sap_reservation_nr / sap_vendor_code / vendor_name
   eotp_full_path / invoice_date / year / month / amount_eur
   compte_budgetaire / cost_type (EXTERNAL | DIRECT_COST)
   eotp_definition_id → EotpDefinition   (via root EOTP lookup)
   import_warning     → set when EOTP root not found in eotp_definition


   EOTP FORMAT NOTE:
   VIM full path:  7/D/0056/001.02.02
   Root extracted: 7/D/0056              ← matches eotp_definition.eotp
   Extraction rule: split on '/', take first 3 parts, rejoin with '/'
```

---

## 8. Salesforce AR Layer (Planned Revenue)

```
   SF EXPORT FILE
   SalesForce_AR_export.csv   (SF report "AR DPM by Product")
   Format: outer-quoted CSV, inner fields semicolon-delimited with double-quote escaping

   CSV COLUMNS (after parsing):
   col 0  Created Date      → AR creation date
   col 1  Contract Number   → sf_contract_number (e.g. "00003325")
   col 2  Activity Sector   → activity_sector (11 Service | 12 Bodyshopping | 13 Mission)
   col 3  Product Item Nr   → sf_product_item_nr (e.g. "SV-MAIL/Basic")
   col 4  Product           → sf_product_name (e.g. "Workplace eMail")
   col 6  Product OTP       → product_eotp (e.g. "8/R/S/0001/043")
   col 7  Account Name      → client_name
   col 8  Contract Name     → contract_name
   col 11 Document Status   → FILTER: keep 'Signed' only
   col 15 Total Price       → amount_eur (quoted, comma decimal: "668,00" → 668.00)
   col 17 Line Item ID      → sf_line_item_id  ← UPSERT KEY (with year)
   col 18 SAP SO Number     → sap_so_number
   year                     → passed as import parameter (no year column in file)

           |
           v  CSV import
   [ar_import]    audit header
           |
           v  ON DELETE CASCADE
   [ar_entry]
   sf_line_item_id (UNIQUE + year) / sf_contract_number / activity_sector
   sf_product_name / sf_product_item_nr / product_eotp
   client_name / contract_name / sap_so_number
   document_status / year / amount_eur
   allocation_entity_id → AllocationEntity   (via product_eotp → eotp_definition → sapEotpCode)
   import_warning       → set when product_eotp not found

   UPSERT on (sf_line_item_id, year):
   Re-importing is idempotent. Handles cancellations (status change) cleanly.


   RESOLUTION PATH:
   product_eotp (e.g. "8/R/S/0001/043")
        → eotp_definition.eotp
        → allocation_entity.sapEotpCode match
        → allocation_entity_id

   NOTE: No Jira key mapping needed. The Product OTP column in the SF export
   is the direct EOTP reference, same format as eotp_definition.
```

---

## 9. SAP Client Invoices Layer (Realized Revenue)

```
   SAP EXPORT FILE
   SAP_Clients_Invoices.csv   (ZCOMM_REPORT, périmètre 1800 = IRISTEAM)
   Format: semicolon-delimited, 68 columns

   KEY COLUMNS:
   col 0  Type document vente    → sap_doc_type (ZCS = invoice, ZCR = credit note)
   col 4  Document de vente      → sap_sales_order
   col 6  Nom (client)           → client_name
   col 20 Article                → sap_article_code (SAP product code 17072–17092)
   col 23 Désignation poste      → product_label
   col 31 Elément d'OTP          → eotp_full (e.g. "8/R/B/0014/001")
   col 40 Numéro externe doc.    → ext_doc_ref (Salesforce contract reference, may be empty)
   col 41 Facture                → sap_invoice_nr  ← FILTER: skip if empty
                                                    ← part 1 of UPSERT KEY
   col 45 Valeur nette           → amount_eur
                                   Format: "33.260,48" (dot=thousands, comma=decimal)
                                   Parse: remove '.', replace ',' with '.' → 33260.48
                                   SIGN: ZCR → amount_eur × -1; ZCS → keep positive
   col 48 Poste                  → sap_invoice_item (integer, e.g. 10/20/30…)
                                   ← part 3 of UPSERT KEY — one DB row per SAP invoice
                                     line item, so multiple Désignation poste lines
                                     under one Facture are NOT collapsed.
   col 58 Exercice comptable     → year (integer; rows mismatching the import-year
                                   parameter are skipped → skippedYearMismatch counter)
                                   ← part 2 of UPSERT KEY
   col 59 Date de la pièce       → invoice_date
                                   Try DD/MM/YYYY first → fall back to Excel 1900-system
                                   serial integer (e.g. 45497) — newer SAP exports use
                                   this even when the column is labeled as a date.

           |
           v  CSV import
   [revenue_import]    audit header
           |
           v  ON DELETE CASCADE
   [revenue_entry]
   sap_invoice_nr / sap_invoice_item / year   ← UNIQUE (sap_invoice_nr, year, sap_invoice_item)
   sap_doc_type / sap_sales_order / ext_doc_ref
   client_name / sap_article_code / product_label / eotp_full
   year / month / amount_eur (signed, see ZCR rule above)
   ar_entry_id          → ArEntry             (set when resolver links an AR line: step 1 direct,
                                                or step 2 via sap_designation_mapping.sf_product_name)
   allocation_entity_id → AllocationEntity    (set by step 1, 2, or 3 below)
   import_warning       → set only on step 2 (no AR link after mapping attempt) or step 4 (nothing resolved)


   4-STEP RESOLUTION (src/lib/revenue-import-resolve.ts)
   --------------------------------------------------------------------------------
   step 1 — ext_doc_ref non-empty
            AND ar_entry exists with
                sf_product_name      = product_label
                counterpart_reference = ext_doc_ref
        →   ar_entry_id = ar.id
            allocation_entity_id = ar.allocation_entity_id   (inherited, no warning)

   step 2 — ext_doc_ref present but step 1 missed
        →   look up sap_designation_mapping[sap_designation = product_label]
        If mapping.sf_product_name is set:
            retry ar_entry with counterpart_reference = ext_doc_ref
                          AND sf_product_name = mapping.sf_product_name
            If AR found → same as step 1 (ar_entry_id + inherited allocation, no warning)
            Else → allocation_entity_id from mapping (when present) + warning
        Else (mapping without sf_product_name, or allocation-only row)
            → allocation_entity_id from mapping (when present) + warning
        If no mapping row → ar_entry_id = NULL, allocation_entity_id = NULL + warning

   step 3 — ext_doc_ref empty
        →   extract EOTP root from eotp_full (col 31)
            → allocation_entity.sapEotpCode match
            → allocation_entity_id (no warning)

   step 4 — nothing resolves
        →   ar_entry_id = NULL, allocation_entity_id = NULL
            warning: "STEP 4: No EOTP and no AR match"

   API response: POST /api/imports/revenue returns
     { import, summary: {
         fileName, importYear, totalLines, parseSkipped, skippedYearMismatch,
         upsertedRows,           ← distinct (sap_invoice_nr, year, sap_invoice_item) —
                                    one per SAP invoice line item (Poste)
         step1Count, step2Count, step3Count, step4Count, warnCount
       } }

   --------------------------------------------------------------------------------
   MANAGED MAPPING TABLE (UI: /imports/mappings, card 4 — see §11 of CONTEXT.md §7.7)

   [sap_designation_mapping]
   sap_designation (UNIQUE)  ←──── e.g. "CRM UC" (SAP Désignation poste, col 23)
   sf_product_name           ←──── reference label (Salesforce product, optional)
   allocation_entity_id ─────────► AllocationEntity (optional — null = "needs review")
   notes                     ←──── free text (e.g. "override", "NEEDS_REVIEW")

   Bootstrap script:
     scripts/build-sap-designation-mapping-csv.ts   (proposes mappings from
                                                     revenue_entry warnings + PRODUCTS.csv)
     scripts/seed-sap-designation-mapping.ts        (upserts the bootstrap CSV)

   Re-running the import after editing mappings is idempotent (same upsert key);
   warnings on previously-imported rows are cleared on the next pass.

   NOTE: SAP Clients Invoices périmètre is 1800 (IRISTEAM), NOT 1700 (Paradigm).
   The invoices go from IRISTEAM to clients. This is the realized cash-in.
```

---

## 10. Reporting Views

```
   [v_realized_costs]
   = timesheet_entry (INTERNAL)
     UNION ALL invoice_entry (EXTERNAL | DIRECT_COST)
   + joined to eotp_definition for: division / sub_division / team / owner
   + joined to allocation_entity for: product_name
   Filterable by: year / month / division / sub_division / team / owner / allocation_entity_id

   [v_planned_revenue]
   = ar_entry  GROUP BY allocation_entity_id × year × sf_product_name × client_name
   Columns: product_name / eotp / activity_sector / sf_product_name / client_name / amount_eur

   [v_realized_revenue]
   = revenue_entry  GROUP BY allocation_entity_id × year × month × sap_article_code
                              × product_label × client_name
   Columns: product_name / eotp / month / sap_article_code / product_label / client_name
            / amount_eur (signed: ZCS positive, ZCR negative — net realized revenue)
            / invoice_count

   NOTE: ar_entry_id, ext_doc_ref, sap_doc_type are NOT projected by v_realized_revenue
         today. Query revenue_entry directly when AR-link drilldowns are needed:
           Power BI relationship: revenue_entry[ar_entry_id] → ar_entry[id]
         (extend the view when reporting needs it.)
```

---

## 11. Full End-to-End Flow

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │  PLANNING (forecasts)                                                    │
 │                                                                          │
 │  [AllocationEntity] ──► [Initiative] ──► [Allocation] + [Rate]          │
 │                                │               │                         │
 │                                │               ▼                         │
 │                                │       [v_allocation_costs]              │
 │                                │               │                         │
 │                                │               ▼                         │
 │                                │       [EotpRouting] (exceptions)        │
 │                                │               │                         │
 │                                │               ▼                         │
 │                                │       [v_eotp_costs]                    │
 │                                │               │                         │
 │                                │               ▼                         │
 │                         [InitiativeRevenue]  [AllocationSnapshot]        │
 │                                              [AllocationSnapshotRow]     │
 │                                                      │                   │
 │                                                      ▼                   │
 │                                             [v_snapshot_detail]          │
 │                                                                          │
 └──────────────────────────────────────────────────────────────────────────┘

 ┌──────────────────────────────────────────────────────────────────────────┐
 │  SAP BUDGET BASELINE (commitments — NOT realized costs)                  │
 │                                                                          │
 │  SAP_CAD_Export_YYYY.csv (FMAVCH01)                                     │
 │  SAP_Reservation_Credits.csv (S_P99_41000147)                           │
 │          │                                                               │
 │          ▼                                                               │
 │  [BudgetBaseline] ──► [BudgetBaselineRow] ──► [v_baseline_detail]        │
 │                                │                                         │
 │                                └────────────────────────┐                │
 │                                                         │                │
 │                                [v_snapshot_detail] ─────┤                │
 │                                                         ▼                │
 │                                                 [v_comparison]           │
 │                                         gap = baseline − catchout        │
 │                                                                          │
 └──────────────────────────────────────────────────────────────────────────┘

 ┌──────────────────────────────────────────────────────────────────────────┐
 │  REALIZED COSTS (actual spend)                                           │
 │                                                                          │
 │  ServiceNow                            SAP VIM Invoices                  │
 │  SN_Time_Card_Export_YYYY.csv          SAP_VIM_Factures_Fournisseurs.csv │
 │  category='Project/Project Task'       status='Approbation terminée'     │
 │  state IN ['Processed','Approved']     compte IN ['1211','1221']         │
 │          │                                     │                         │
 │          ▼                                     ▼                         │
 │  [sn_programme_mapping] ──────────►  [invoice_entry]                    │
 │  (managed in-app, from Excel)         EOTP root → eotp_definition        │
 │          │                                     │                         │
 │          ▼                                     │                         │
 │  [timesheet_entry]                             │                         │
 │  INTERNAL costs                                │                         │
 │  cost = (hours/8) × daily_rate                 │                         │
 │          │                                     │                         │
 │          └──────────────┬──────────────────────┘                         │
 │                         ▼                                                 │
 │                 [v_realized_costs]                                        │
 │                 INTERNAL | EXTERNAL | DIRECT_COST                        │
 │                 filterable by year/month/ownership hierarchy              │
 │                                                                           │
 └───────────────────────────────────────────────────────────────────────────┘

 ┌───────────────────────────────────────────────────────────────────────────┐
 │  REVENUE                                                                   │
 │                                                                            │
 │  Salesforce AR                         SAP Client Invoices                 │
 │  SalesForce_AR_export.csv              SAP_Clients_Invoices.csv            │
 │  status='Signed'                       col 41 (Facture) not empty          │
 │  périmètre: IRISTEAM AR               périmètre 1800 (IRISTEAM)           │
 │          │                                     │                           │
 │          ▼                                     ▼                           │
 │  [ar_entry]  ◄────── ar_entry_id ────  [revenue_entry]                    │
 │  product_eotp                          sap_doc_type (ZCS/ZCR)              │
 │  → eotp_definition                     ext_doc_ref (col 40)                │
 │  → allocation_entity (sapEotpCode)     eotp_full                           │
 │  UPSERT (sf_line_item_id, year)        4-step resolver (§9):               │
 │          │                              1. AR match by (sf_product_name,   │
 │          │                                 counterpart_reference)          │
 │          │                              2. sap_designation_mapping         │
 │          │                              3. EOTP root → allocation_entity   │
 │          │                              4. NULL + warning                  │
 │          │                             UPSERT (sap_invoice_nr, year,       │
 │          │                                     sap_invoice_item)            │
 │          │                                     │                           │
 │          ▼                                     ▼                           │
 │  [v_planned_revenue]              [v_realized_revenue]                     │
 │  per product × year               per product × year × month              │
 │                                   amount_eur signed (ZCR negated)          │
 │                                                                            │
 │      revenue_gap = planned_ar − realized_revenue                           │
 │                                                                            │
 │  [sap_designation_mapping]   ←  managed at /imports/mappings (card 4)      │
 │  Backs step 2 of the revenue resolver.                                     │
 │                                                                            │
 └────────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Key Rules

```
TIMESHEET COSTS
  Only category='Project/Project Task' is imported
  Only state IN ['Processed','Approved'] is imported
  cost_eur = (hours / 8.0) × COALESCE(Rate.dailyRate, RateStandard.dailyRate)
  sn_programme_name → sn_programme_mapping → allocation_entity_id  (REQUIRED)
  sn_project_nr     → sn_project_mapping   → initiative_id         (OPTIONAL, not a warning)

SAP VIM INVOICES
  Skip: Descr='Annulé', Compte=T_GRIR, Compte=empty
  Import: Descr='Approbation terminée' AND Compte IN ('1211','1221')
  1211 → EXTERNAL, 1221 → DIRECT_COST
  EOTP extraction: first 3 slash-segments of Elément d'OTP

SALESFORCE AR
  Import only Document Status='Signed'
  Year = import parameter (file has no year column)
  UPSERT on (sf_line_item_id, year) — idempotent re-import

SAP CLIENT INVOICES
  Skip rows where Facture (col 41) is empty
  Skip rows where col 58 (Exercice comptable) ≠ import-year parameter
  Amount parsing: '33.260,48' → remove dot → '33260,48' → replace comma → 33260.48
  Sign: col 0 ZCR → amount_eur × -1; ZCS → keep positive (sap_doc_type stored)
  Date parsing: col 59 → DD/MM/YYYY first, fall back to Excel 1900-system serial integer
  UPSERT on (sap_invoice_nr, year, sap_invoice_item) — one row per SAP invoice
    line item (Poste, col 48), so multiple Désignation poste lines under one
    Facture each get their own revenue_entry row
  Périmètre 1800 = IRISTEAM (not 1700 = Paradigm)
  4-step resolver (NEVER reject rows — write import_warning when unresolved):
    step 1: ext_doc_ref match against ar_entry → ar_entry_id + inherit allocation_entity_id
    step 2: ext_doc_ref present, step 1 miss → sap_designation_mapping; if sf_product_name
            on mapping → retry AR match; else allocation from mapping; warnings when no AR link
    step 3: ext_doc_ref empty → EOTP root → allocation_entity.sapEotpCode → no warning
    step 4: nothing matches → NULL + warning
  API response includes step1Count / step2Count / step3Count / step4Count / warnCount

SAP_DESIGNATION_MAPPING (managed table, edited at /imports/mappings card 4)
  UNIQUE on sap_designation
  Backs step 2 of the SAP client invoice resolver (AR retry via sf_product_name, else allocation)
  Bootstrap: scripts/build-sap-designation-mapping-csv.ts proposes from
             revenue_entry warnings + PRODUCTS.csv (with overrides for known cases
             like "CRM UC" → PRD-CRM); seed-sap-designation-mapping.ts upserts the CSV

SAP BUDGET FILES (NOT imported into realized layer)
  SAP_CAD_Export_YYYY.csv       → BudgetBaseline only
  SAP_Reservation_Credits.csv   → BudgetBaseline only

EOTP ROOT EXTRACTION (for both VIM and Client Invoices)
  Input:  7/D/0056/001.02.02  →  Root: 7/D/0056
  Input:  8/R/S/0001/043      →  Try full value first, then 8/R/S/0001
  Rule: split('/'), take [:3], rejoin('/')

ALL IMPORTS
  Rows never rejected — always stored, import_warning set if unresolved
  ON DELETE CASCADE on all import_id FKs
  dynamic = "force-dynamic" on all report pages
  Never modify v_allocation_costs or v_eotp_costs
```
