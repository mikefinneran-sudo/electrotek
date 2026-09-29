# ElectroTek FileMaker Field Inventory

Source: `~/active/electrotek/filemaker-backup-2026-08-20/electrotek.sqlite` (fmp2sqlite extract, 30 tables). Row counts and checksums verified against `electrotek-fidelity.md` (pass). Compared against `packages/module-forensic-case/src/types.ts` (267 lines, 7 entities: `evidence`, `claimants`, `addresses`, `contact_methods`, `participants`, `depositions`, `time_entries`).

## LIMITATIONS — read before using this as Gate 1

This is a **schema-level inventory, not a screen inventory**. It satisfies the "every field, fill rate, picklist values" part of Gate 1 but not the "screen order, screen labels, tab layout" part — the fidelity report is explicit that a `.fmp12`/sqlite extract "exposes base tables rather than layouts." Column order below is FileMaker's internal field order (`PRAGMA table_info`), which approximates but does not guarantee on-screen order. Field labels below are the raw column names (`E#_of_peices`, `DEscription`), not necessarily what staff read on the layout. **No screenshots, screen recording, or live walkthrough of the FileMaker file were used to produce this document.** Before Gate 2/3 work starts on any table below, get eyes on the actual layout — this document tells you what exists, not what staff look at first or how it is grouped on screen.

## Top gaps between FileMaker and the new app

1. **`case_notes` (3,700 rows) — entirely absent from `types.ts`.** No entity, no field, nothing. Columns `date`, `Enteredby`, `Direction` (To 3625 / From 20), `Type`, `Description`, `Subject` are all 97–100% filled — this is a heavily-used, high-fill table (case correspondence/activity log) with zero representation in the new schema.
2. **`Expenses` (23,869 rows) and `ExpenseItems` (60-row picklist) — entirely absent from `types.ts`.** This is the single largest FileMaker table by row count and it has no home in the new app. Its columns (`staff_id`, `HourlyRate`, `Hours`, `Total`, `category` [Expense 12,291 / Time 11,544], `Multiplier`, `MultipliedExpenses`, `Invoice#`, `Location`, `Date`, `DEscription`) line up closely with the `time_entries` entity already *declared* in `types.ts` (`hours`, `hourly_rate`, `multiplier`, `invoice_number`, `billed_amount`, `category`, `location`, `entry_date`, `description`) — but nothing in this extract or in `types.ts` shows those 23,869 rows actually migrated into `time_entries`. Confirm with whoever owns the migration pipeline before assuming it's covered.
3. **CORRECTED — a `cases` entity does exist, owned by `module-crm`, not `module-forensic-case`.** `packages/module-crm/src/types.ts:34` defines `interface Case` (`case_number`, `account_id`, `contact_id`, `title`, `status`, `case_type`, `incident_date`, `incident_location`, `opened_on`, `closed_on`, `notes`, `custom_fields`, `legacy_id`, `source_system`). `module-forensic-case`'s tables FK to it deliberately; `packages/module-forensic-case/src/migration.spec.ts:27` even asserts the module's migration "does not mutate the CRM-owned cases table." So `Status` (Closed 3692 / Active 156 / Inactive 2) has a destination (`cases.status`, three-value enum `open`/`on_hold`/`closed` per `packages/module-crm/supabase/migrations/0007_cases.sql:42`). The gap narrows but survives: FileMaker's other live `Cases` columns — `Manufacturer` (79.9% filled), `Investigator` (99.9%), `Expert` (100%), `Client` (100%) — have **no typed column** on `public.cases`. The only place they could land is the untyped `custom_fields jsonb` catch-all added in `packages/module-crm/supabase/migrations/0008_cases_platform_grade.sql:18`, and nothing in the repo shows a mapping into it (see migration-status section below).
4. **`Attorneys`, `Experts`, `LawFirms`, `Companies`, `Staff` — no entity of their own.** `types.ts` folds attorney/expert people into the generic `participants` entity (`participant_type`, `role`, `notes`) via `contact_id`/`account_id`, but the source tables carry real fields (`Attorneys.Position`, `Experts.EMail`, `Companies.Category` [77.4% filled], `Staff.HourlyRate`, `Staff.Initials`) that have no matching column anywhere in `types.ts`. Whether `participants` + `addresses` + `contact_methods` actually absorb this data depends on the migration code, not on `types.ts` alone — worth verifying directly.
5. **Cases table is mostly dead weight, but the live 18 columns are not covered.** 93 of 111 `Cases` columns are effectively unused (0% or near-0% fill — largely a bank of unused `Claimant_*`, `SCJ_*`, and `G_*` global/summary fields FileMaker layouts carried for calculations). That's expected FileMaker cruft. But the 18 that ARE live (listed in gap #3) still have no typed destination in the new schema, and that's the part that matters.

## Migration status — verified against the repo, not inferred from schema names

`docs/ELECTROTEK-BUILD-PLAN.md:64-68` lists "Phase 3 — Migrate" as a future phase and warns explicitly: "an import that 'ran' is not an import whose data is usable. Verify by reading rows back and reconciling counts against FileMaker." A repo-wide search for an actual loader — any `INSERT INTO public.<table>`, `COPY public.<table>`, seed script, or Python/TS file referencing `electrotek.sqlite` / `fmp2sqlite` / `FileMaker` outside of comments and this build plan — found **nothing**. `supabase/seed.sql` and `apps/electrotek/scripts/seed-staff.ts` contain no `legacy_id`/`source_system`/FileMaker references. So every verdict below reflects **schema readiness**, not data actually present in a database — there is no database state in this repo to inspect; the check is "does a destination exist and is there code that would populate it."

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | `Expenses` (23,869 rows: category Expense 12,291 / Time 11,544) | **NOT MIGRATED** (schema staged, split correctly, zero import code) | Split is deliberate and correct: the "Time" half has a destination at `case_time_entries` — `packages/module-forensic-case/supabase/migrations/0001_forensic_case.sql` comments it as "The hours half of FileMaker Expenses. Reimbursable costs continue to use `public.expenses`... they are not duplicated here," and `packages/module-forensic-case/src/migration.spec.ts:47-52` asserts the module migration does NOT create/alter `public.expenses`. The "Expense" half has a destination at `public.expenses` — `packages/module-expense/supabase/migrations/0001_expense.sql:2` states "Every table carries legacy_id/source_system for **the deferred FileMaker import**" (its own word: deferred). Both tables carry `legacy_id`/`source_system` columns ready to receive rows, but no INSERT/COPY/seed statement anywhere loads FileMaker rows into either. **Landmine for whoever runs this import:** `packages/module-expense/src/types.ts` documents `'case'` as a valid `ExpenseSubjectType` ("the attribution a forensic practice actually bills on"), but the live DB constraint at `packages/module-expense/supabase/migrations/0001_expense.sql` (`expenses_subject_type_valid`) only allows `('customer', 'opportunity', 'unattributed')` — `'case'` is not in the CHECK. An import that writes `subject_type = 'case'` as the type comment implies will be rejected by the database as currently migrated. |
| 2 | `case_notes` (3,700 rows) | **NOT MIGRATED — no destination exists at all** | Repo-wide search (`grep -rl "case_notes\|CaseNote\|casenotes"` across all `.ts`/`.sql`/`.tsx`) returns zero hits anywhere in the codebase except this inventory file. Unlike `Expenses` and `Cases`, there is no staged table, no `legacy_id` column reserved, no mention in `docs/ELECTROTEK-BUILD-PLAN.md`. This is a harder gap than #1: not "migration deferred," but "no one has scoped a destination for it yet." |
| 3 | `Attorneys.Position`, `Experts.EMail` | **CANNOT DETERMINE FROM REPO** | `module-crm`'s `Contact` interface (`packages/module-crm/src/types.ts`) has `title` and `email` columns that are plausible destinations, and `module-forensic-case`'s `case_participants` table links a case to a `contact_id` with `participant_type in ('expert','attorney','contact')` (`packages/module-forensic-case/supabase/migrations/0001_forensic_case.sql`). But no import code exists anywhere in the repo to confirm attorneys/experts actually get materialized as `Contact` rows, or that `Position`→`title` / `EMail`→`email` is the mapping used. Both fields are near-empty in the source anyway (`Position` 2.1%, `EMail` 0.0%), so the practical impact is small regardless. |
| 4 | `Companies.Category` (77.4% filled) | **CANNOT DETERMINE FROM REPO** | `module-crm`'s `Account` interface has an `industry` field that is a plausible but unconfirmed destination — no mapping code exists in the repo to verify `Category` values land there, or land anywhere at all. |
| 5 | `Staff.HourlyRate`, `Staff.Initials` | **NOT MIGRATED — no destination exists, confirmed** | `public.staff` is defined at `supabase/migrations/0000_admin_foundation.sql:28-32` as `id uuid primary key references auth.users(id) on delete cascade, email text, created_at timestamptz`. No `HourlyRate`, no `Initials`, no `legacy_id`/`source_system` column at all — `id` is a hard FK to `auth.users`, meaning `public.staff` rows are created by real login/signup, not by any batch import. There is no column this data could migrate into even in principle, unlike the other gaps above where a plausible (if unverified) destination exists. |

## Cases (3,850 rows, 111 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (3850) | no |
| 2 | `FC` | 0.0% | NULL (3850) | no |
| 3 | `One` | 100.0% | 1 (3850) | no |
| 4 | `PK_ID#` | 100.0% | 3849 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (3850) | no |
| 6 | `RC` | 0.0% | NULL (3850) | no |
| 7 | `G_Text` | 0.0% | NULL (3850) | no |
| 8 | `G_Num` | 0.0% | NULL (3850) | no |
| 9 | `Serial_#` | 100.0% | 3850 distinct (too many to list) | no |
| 10 | `Filter` | 0.2% | NULL (3841); haf (2); schu (1); oken (1); fisse (1); coz (1); car (1); bot (1); Bari (1) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (3850) | no |
| 12 | `Index` | 0.0% | NULL (3850) | no |
| 13 | `G_Index` | 0.0% | NULL (3850) | no |
| 14 | `client_id` | 99.9% | 299 distinct (too many to list) | no |
| 15 | `Case_id` | 100.0% | 3849 distinct (too many to list) | yes |
| 16 | `Manufacturer` | 79.9% | 393 distinct (too many to list) | no |
| 17 | `project#` | 0.0% | NULL (3850) | no |
| 18 | `Date` | 100.0% | 2473 distinct (too many to list) | no |
| 19 | `P_Serial#` | 10.8% | 416 distinct (too many to list) | no |
| 20 | `P_UPC` | 1.2% | 40 distinct (too many to list) | no |
| 21 | `WhereBought` | 1.8% | 37 distinct (too many to list) | no |
| 22 | `TimeinUse` | 1.6% | 60 distinct (too many to list) | no |
| 23 | `Address_ID` | 98.0% | 684 distinct (too many to list) | no |
| 24 | `Contact_ID` | 99.9% | 694 distinct (too many to list) | yes |
| 25 | `Status` | 100.0% | Closed (3692); Active (156); Inactive (2) | yes |
| 26 | `Closed` | 100.0% | Closed Inactive (3850) | no |
| 27 | `G_Company` | 0.0% | NULL (3850) | no |
| 28 | `G_CompanyCategory` | 0.0% | NULL (3850) | no |
| 29 | `Open_cases` | 0.0% | NULL (3850) | no |
| 30 | `Closed_cases` | 0.0% | NULL (3850) | no |
| 31 | `Case#` | 100.0% | 3850 distinct (too many to list) | no |
| 32 | `MaxCase#` | 0.0% | NULL (3850) | no |
| 33 | `Clients_Filter` | 0.0% | NULL (3850) | no |
| 34 | `Manufacturer_Filter` | 0.0% | NULL (3850) | no |
| 35 | `Client` | 100.0% | Client (3850) | no |
| 36 | `Product_Filter` | 0.0% | NULL (3850) | no |
| 37 | `LawFirmsCount` | 0.0% | NULL (3850) | no |
| 38 | `Add_LawFirm` | 0.0% | NULL (3850) | no |
| 39 | `OpenCaseIDs` | 0.0% | NULL (3850) | no |
| 40 | `ClientName` | 0.0% | NULL (3850) | no |
| 41 | `Product` | 73.3% | 762 distinct (too many to list) | no |
| 42 | `Case#_User` | 100.0% | 3850 distinct (too many to list) | no |
| 43 | `Case#_Txt` | 100.0% | 3850 distinct (too many to list) | no |
| 44 | `Model#` | 27.5% | 924 distinct (too many to list) | no |
| 45 | `Product_Model` | 0.0% | NULL (3850) | no |
| 46 | `Int_Model` | 27.5% | 703 distinct (too many to list) | no |
| 47 | `Int_Model_TXT` | 27.5% | 703 distinct (too many to list) | no |
| 48 | `C4M` | 0.0% | NULL (3850) | no |
| 49 | `List_cases` | 0.0% | NULL (3850) | no |
| 50 | `G_Case#` | 0.0% | NULL (3850) | no |
| 51 | `G_LawFirm` | 0.0% | NULL (3850) | no |
| 52 | `G_Lawyer` | 0.0% | NULL (3850) | no |
| 53 | `Locations_List` | 0.0% | NULL (3850) | no |
| 54 | `City` | 98.7% | 195 distinct (too many to list) | yes |
| 55 | `Client_Case#` | 3.0% | 115 distinct (too many to list) | no |
| 56 | `Client_File#` | 15.0% | 557 distinct (too many to list) | no |
| 57 | `Client_Request#` | 0.0% | NULL (3850) | no |
| 58 | `Client_Claim#` | 58.9% | 2255 distinct (too many to list) | no |
| 59 | `Client_Request` | 22.0% | 723 distinct (too many to list) | no |
| 60 | `Investigator` | 99.9% | 105-040087-121311 (1706); 106-154432-121311 (1096); JMF (577); 107-667368-121311 (228); JVM (219); LKB (17); NULL (3); JMf (2); MRT (1); JMF  (1) | no |
| 61 | `Prod_Recd` | 0.1% | NULL (3845); 10/5/2004 (2); 10/25/2012 (2); 3/27/2004 (1) | no |
| 62 | `Photos` | 16.0% | NULL (3234); Yes (603); No (13) | no |
| 63 | `G_ExpCategory` | 0.0% | NULL (3850) | no |
| 64 | `Added_By` | 86.8% | user (3341); NULL (508); admin (1) | no |
| 65 | `Claimant_First` | 0.0% | NULL (3850) | no |
| 66 | `Claimant_last` | 0.0% | NULL (3850) | no |
| 67 | `Claimant_Company` | 0.0% | NULL (3850) | no |
| 68 | `Claimant_ID` | 0.0% | NULL (3850) | no |
| 69 | `Claimant_Status` | 0.0% | NULL (3850) | no |
| 70 | `Claimant_Address` | 0.0% | NULL (3850) | no |
| 71 | `ClaimantHomePhone` | 0.0% | NULL (3850) | no |
| 72 | `ClaimantWorkPhone` | 0.0% | NULL (3850) | no |
| 73 | `ClaimantCellPhone` | 0.0% | NULL (3850) | no |
| 74 | `ClaimantCity` | 0.0% | NULL (3850) | no |
| 75 | `ClaimantState` | 0.0% | NULL (3850) | no |
| 76 | `ClaimantZip` | 0.0% | NULL (3850) | no |
| 77 | `Claimant_Address2` | 0.0% | NULL (3850) | no |
| 78 | `ClaimantDateofLoss` | 0.0% | NULL (3850) | no |
| 79 | `Claimant` | 0.0% |  (3850) | no |
| 80 | `Claimant_NoStatus` | 0.0% |  (3850) | no |
| 81 | `ClaimantEMail` | 0.0% | NULL (3850) | no |
| 82 | `Companies_Filter` | 0.0% | NULL (3850) | no |
| 83 | `TheClaimant` | 0.0% | NULL (3850) | no |
| 84 | `DE_ClientName` | 0.0% | NULL (3850) | no |
| 85 | `HasCases` | 0.0% | NULL (3850) | no |
| 86 | `Client#s` | 0.0% | NULL (3850) | no |
| 87 | `WorkOrderNotes` | 11.7% | 446 distinct (too many to list) | no |
| 88 | `P_DateCode` | 0.2% | NULL (3844); NA (1); K1795 (1); December 2002 (1); 0499 (1); 02H (1); 01 J (1) | no |
| 89 | `Claimants_List` | 0.0% | NULL (3850) | no |
| 90 | `Claimants_String` | 0.0% | NULL (3850) | no |
| 91 | `SCJ_ContactDate` | 0.0% | NULL (3849); 2/23/2001 (1) | no |
| 92 | `SCJ_envSent` | 0.1% | NULL (3848); 10/5/2004 (2) | no |
| 93 | `SCJ_category` | 0.0% | NULL (3850) | no |
| 94 | `SCJ_billableTime` | 0.0% | NULL (3850) | no |
| 95 | `SCJShipping` | 0.1% | NULL (3846); 13.26 (3); 11.60 (1) | no |
| 96 | `SCJ_Prodfound` | 0.0% | NULL (3850) | no |
| 97 | `SCJResults` | 0.0% | NULL (3850) | no |
| 98 | `scj_Xray` | 0.0% | NULL (3850) | no |
| 99 | `SCJ_report` | 0.0% | NULL (3850) | no |
| 100 | `SCJ_photos` | 0.0% | NULL (3850) | no |
| 101 | `Expert` | 100.0% | expert (3850) | no |
| 102 | `ContactDate` | 0.1% | NULL (3845); 8/4/2016 (1); 6/24/2011 (1); 12/18/2014 (1); 12/14/2011 (1); 11/1/2012 (1) | no |
| 103 | `SiteDate` | 39.9% | 1393 distinct (too many to list) | no |
| 104 | `Examdate1` | 56.4% | 1816 distinct (too many to list) | no |
| 105 | `ExamDate2` | 8.0% | 299 distinct (too many to list) | no |
| 106 | `Examdate3` | 2.0% | 77 distinct (too many to list) | no |
| 107 | `ExamDate4` | 0.5% | NULL (3830); 9/2/2014 (1); 8/5/2022 (1); 8/27/2015 (1); 8/16/2012 (1); 7/17/2013 (1); 6/18/2013 (1); 6/13/2012 (1); 5/24/2021 (1); 4/21/2021 (1); 4/19/2016 (1); 4/16/2007 (1); 4/15/2013 (1); 3/8/2026 (1); 2/1/2023 (1); 12/4/2014 (1); 11/6/2013 (1); 11/3/2015 (1); 11/20/2014 (1); 10/4/2004 (1); 1/10/2013 (1) | no |
| 108 | `Examdate5` | 0.2% | NULL (3842); 9/3/2014 (1); 6/27/2023 (1); 5/25/2021 (1); 3/9/2026 (1); 2/19/2014 (1); 12/12/2014 (1); 11/8/2016 (1); 10/16/2013 (1) | no |
| 109 | `DepoDate` | 0.9% | 34 distinct (too many to list) | no |
| 110 | `ReportDate` | 6.3% | 209 distinct (too many to list) | no |
| 111 | `TrialDate` | 0.1% | NULL (3845); 6/26/2014 (1); 5/20/2021 (1); 4/3/2013 (1); 11/25/2008 (1); 1/24/2013 (1) | no |

## Evidence (4,457 rows, 37 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (4457) | no |
| 2 | `FC` | 0.0% | NULL (4457) | no |
| 3 | `One` | 100.0% | 1 (4457) | no |
| 4 | `PK_ID#` | 8.4% | 375 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (4457) | no |
| 6 | `RC` | 0.0% | NULL (4457) | no |
| 7 | `G_Text` | 0.0% | NULL (4457) | no |
| 8 | `G_Num` | 0.0% | NULL (4457) | no |
| 9 | `Serial_#` | 8.4% | 375 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (4457) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (4457) | no |
| 12 | `Index` | 0.0% | NULL (4457) | no |
| 13 | `G_Index` | 0.0% | NULL (4457) | no |
| 14 | `Project_id` | 100.0% | 4263 distinct (too many to list) | no |
| 15 | `D_Evidence_DispDate` | 5.7% | 158 distinct (too many to list) | no |
| 16 | `D_Report_date` | 10.1% | 331 distinct (too many to list) | no |
| 17 | `Date` | 0.0% | NULL (4457) | no |
| 18 | `E_action` | 13.0% | NULL (3877); Discarded  (315); Discarded (121); Returned (101); Forward (43) | no |
| 19 | `E#_of_peices` | 23.9% | 120 distinct (too many to list) | no |
| 20 | `EAction_Date` | 12.8% | 197 distinct (too many to list) | no |
| 21 | `EDate_reciev` | 11.8% | 314 distinct (too many to list) | no |
| 22 | `EDesctrip` | 18.8% | 814 distinct (too many to list) | no |
| 23 | `EDispositionSent` | 5.8% | NULL (4197); Yes  (242); 1/28/2002 (7); No (3); 8/6/2001 (1); 7/16/2002 (1); 3/12/2002 (1); 2/2/2002 (1); 10/29/2001 (1); 1/9/2002 (1); 1/18/2002 (1); 1/10/2002 (1) | no |
| 24 | `EInitials` | 9.3% | NULL (4041); JVM (247); jvm (102); MLA (33); KM (16); JMF (14); jmf (2); RF (1); LKB (1) | no |
| 25 | `ELocation` | 19.2% | NULL (3600); Lab (140); Storage Shed (132); Shelving 1B (116); Upstairs (98); Shelving 2C (76); Shelving 2B (71); Large Storage (63); Shelving 1C (55); Shelving 1A (34); Shelving 2A (23); Shelving (22); Shelving 1D (20); Shelving 3A (2); office (1); Shelving 3B (1); JIm's Office (1); Doug Rayburn (1); 2B (1) | no |
| 26 | `EOhter#_of_peices` | 0.0% | NULL (4457) | no |
| 27 | `EOther_location` | 0.3% | NULL (4444); Large Storage (7); Lab (3); Shelving 1B (2); Upstairs (1) | no |
| 28 | `EResponce` | 20.6% | NULL (3538); Discard (623); Store Non-Billable  (109); Forward (65); Return  (58); Return (53); Retain (11) | no |
| 29 | `EResults` | 29.3% | 1142 distinct (too many to list) | no |
| 30 | `EReturned_to` | 2.2% | 86 distinct (too many to list) | no |
| 31 | `EStorage` | 0.0% | NULL (4457) | no |
| 32 | `EXray` | 0.4% | NULL (4437); Yes  (17); No (2); In File (1) | no |
| 33 | `Exray_date` | 0.2% | NULL (4446); 2/26/2003 (2); 9/26/2002 (1); 8/21/2003 (1); 7/3/2002 (1); 7/28/2003 (1); 6/13/2003 (1); 3/19/2003 (1); 2/23/2005 (1); 12/22/2003 (1); 10/7/2014 (1) | no |
| 34 | `Project_No.` | 0.0% | NULL (4457) | no |
| 35 | `Status` | 0.0% | NULL (4456); Active (1) | yes |
| 36 | `Workorder_evidence` | 38.7% | 847 distinct (too many to list) | no |
| 37 | `Project_idAs#` | 100.0% | 4256 distinct (too many to list) | no |

## Case_Notes (3,700 rows, 22 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (3700) | no |
| 2 | `FC` | 0.0% | NULL (3700) | no |
| 3 | `One` | 100.0% | 1 (3700) | no |
| 4 | `PK_ID#` | 100.0% | 3700 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (3700) | no |
| 6 | `RC` | 0.0% | NULL (3700) | no |
| 7 | `G_Text` | 0.0% | NULL (3700) | no |
| 8 | `G_Num` | 0.0% | NULL (3700) | no |
| 9 | `Serial_#` | 100.0% | 3700 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (3700) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (3700) | no |
| 12 | `Index` | 0.0% | NULL (3700) | no |
| 13 | `G_Index` | 0.0% | NULL (3700) | no |
| 14 | `Case_id` | 100.0% | 2737 distinct (too many to list) | yes |
| 15 | `destination_id` | 0.0% | NULL (3700) | no |
| 16 | `date` | 100.0% | 1001 distinct (too many to list) | no |
| 17 | `Enteredby` | 100.0% | 108-718036-121311 (3600); 103-728974-031811 (44); 105-040087-121311 (32); 107-667368-121311 (14); 106-154432-121311 (10) | no |
| 18 | `Direction` | 98.5% | To (3625); NULL (55); From (20) | no |
| 19 | `OtherParty` | 0.4% | NULL (3686); Bill Smith (3); photos (1); T Schult, S Thomack (1); Mr. Harmeyer (1); Molly Anderson (1); Mike Carroll (1); Mary Jo Kuusela (1); Maria Thorp (1); LIPA (1); Josh Wolfer (1); Jim yankosky (1); Comack Fire Chief (1) | no |
| 20 | `Type` | 98.6% | 27 distinct (too many to list) | no |
| 21 | `Description` | 97.7% | 1844 distinct (too many to list) | yes |
| 22 | `Subject` | 98.3% | 144 distinct (too many to list) | no |

## Clients (1,623 rows, 39 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (1623) | no |
| 2 | `FC` | 0.0% | NULL (1623) | no |
| 3 | `One` | 100.0% | 1 (1623) | no |
| 4 | `PK_ID#` | 100.0% | 1621 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (1623) | no |
| 6 | `RC` | 0.0% | NULL (1623) | no |
| 7 | `G_Text` | 0.0% | NULL (1623) | no |
| 8 | `G_Num` | 0.0% | NULL (1623) | no |
| 9 | `Serial_#` | 83.9% | 1330 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (1623) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (1623) | no |
| 12 | `Index` | 0.0% | NULL (1623) | no |
| 13 | `G_Index` | 0.0% | NULL (1623) | no |
| 14 | `Company_id` | 98.6% | 650 distinct (too many to list) | no |
| 15 | `address_id` | 47.2% | 547 distinct (too many to list) | no |
| 16 | `order_id` | 0.0% | NULL (1623) | no |
| 17 | `part_id` | 0.0% | NULL (1623) | no |
| 18 | `First_Name` | 92.1% | 658 distinct (too many to list) | yes |
| 19 | `Last_Name` | 92.2% | 1197 distinct (too many to list) | yes |
| 20 | `C_Name` | 92.6% | 1433 distinct (too many to list) | no |
| 21 | `Category` | 0.0% | NULL (1623) | yes |
| 22 | `Title` | 1.3% | NULL (1602); Attorney (8); Claims Examiner (5); Adjuster (3); Vice President of Product Safety (1); Principal (1); Partner (1); Mrs. (1); Engineer (1) | no |
| 23 | `ContactNumbers` | 0.0% | NULL (1623) | no |
| 24 | `CaseList` | 0.0% | NULL (1623) | no |
| 25 | `cDisplayText` | 0.0% | NULL (1623) | no |
| 26 | `#active_cases` | 0.0% | NULL (1623) | no |
| 27 | `C_Name_Display` | 0.0% | NULL (1623) | no |
| 28 | `DupClient` | 99.1% | 1505 distinct (too many to list) | no |
| 29 | `ContactID` | 58.3% | 857 distinct (too many to list) | no |
| 30 | `C_NameRev` | 92.5% | 1432 distinct (too many to list) | no |
| 31 | `Active` | 100.0% | Active (1623) | no |
| 32 | `#cases` | 0.0% | NULL (1623) | no |
| 33 | `HasCases` | 0.0% | NULL (1623) | no |
| 34 | `SameAs` | 0.0% | NULL (1623) | no |
| 35 | `ContactEMails` | 0.0% | NULL (1623) | no |
| 36 | `ContactEMailsString` | 0.0% | NULL (1623) | no |
| 37 | `ContactNumbersString` | 0.0% | NULL (1623) | no |
| 38 | `Addresses_String` | 0.0% | NULL (1623) | no |
| 39 | `Old` | 61.1% | 1 (992); NULL (631) | no |

## Join_Case_Claimants (3,975 rows, 39 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (3975) | no |
| 2 | `FC` | 0.0% | NULL (3975) | no |
| 3 | `One` | 100.0% | 1 (3975) | no |
| 4 | `PK_ID#` | 100.0% | 3975 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (3975) | no |
| 6 | `RC` | 0.0% | NULL (3975) | no |
| 7 | `G_Text` | 0.0% | NULL (3975) | no |
| 8 | `G_Num` | 0.0% | NULL (3975) | no |
| 9 | `Serial_#` | 100.0% | 3975 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (3975) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (3975) | no |
| 12 | `Index` | 0.0% | NULL (3975) | no |
| 13 | `G_Index` | 0.0% | NULL (3975) | no |
| 14 | `customer_id` | 0.0% | NULL (3975) | no |
| 15 | `destination_id` | 0.0% | NULL (3975) | no |
| 16 | `order_id` | 0.0% | NULL (3975) | no |
| 17 | `part_id` | 0.0% | NULL (3975) | no |
| 18 | `Claimant` | 98.5% | 3867 distinct (too many to list) | no |
| 19 | `Claimant_Address` | 78.7% | 3108 distinct (too many to list) | no |
| 20 | `Claimant_Address2` | 0.3% | NULL (3964); pattijoduke01@yahoo.com (1); et7704@bellsouth.net (1); Waterford Apartments (1); South Hill (1); SFI # 22-G153-617 (1); PO Box 357 Red Lodge MT  59068 (1); Greenbriar Apartmenrs (1); 3771 East 10 Mile (1); 19877 E. Country Club Dr. (1); 121 Connecticut Avenue (1); "Prichard Housing Authority" (1) | no |
| 21 | `Claimant_Company` | 0.0% | NULL (3975) | no |
| 22 | `Claimant_First` | 90.1% | 3058 distinct (too many to list) | no |
| 23 | `Claimant_ID` | 0.0% | NULL (3975) | no |
| 24 | `Claimant_last` | 97.8% | 3840 distinct (too many to list) | no |
| 25 | `Claimant_NoStatus` | 98.0% | 3864 distinct (too many to list) | no |
| 26 | `Claimant_Status` | 97.8% | Claimant (3624); Insured (263); NULL (86); a (1); Travelers (a/s/o Robert Scholnick d/b/a Antiques at 80 Ch... (1) | no |
| 27 | `ClaimantCellPhone` | 1.5% | 61 distinct (too many to list) | no |
| 28 | `ClaimantCity` | 83.9% | 2033 distinct (too many to list) | no |
| 29 | `ClaimantDateofLoss` | 84.1% | 2604 distinct (too many to list) | no |
| 30 | `ClaimantEMail` | 0.5% | NULL (3956); sunflower3838@gmail.com (1); sueedington69@gmail.com (1); sbpiland@onecliq.net (1); rebdon78@gmail.com (1); pamthomp28@gmail.com (1); lsjw5@yahoo.com (1); laurelallman@yahoo.com (1); lane@forensicgroup.com (1); krebsm@nationwide.com (1); kanishasolis@gmail.com (1); hairguy935@gmail.com (1); frankophone2009@gmail.com (1); essance.scott123@gmail.com (1); colebe65@gmail.com (1); asma.jaff@gmail.com (1); angela.n.diaz91@gmail.com (1); ambersking@gmail.com (1); almaitlin@aol.com (1); Msbjhop@gmail.com (1) | no |
| 31 | `ClaimantHomePhone` | 1.4% | 54 distinct (too many to list) | no |
| 32 | `ClaimantState` | 85.1% | 71 distinct (too many to list) | no |
| 33 | `ClaimantWorkPhone` | 0.4% | NULL (3959); 712 (2); 770 (1); 713 (1); 315 (1); 304 (1); 205 (1); (812) 267-3417 (1); (800) 262-9250 (1); (765) 463-9100 (1); (616) 293-7886 (1); (585) 261-6672 (1); (574) 516-1678 (1); (313) 690-2606 (1); (260) 489-7900 (1); (219) 531-2299 (1) | no |
| 34 | `ClaimantZip` | 17.3% | 658 distinct (too many to list) | no |
| 35 | `PK_ID` | 100.0% | 3975 distinct (too many to list) | no |
| 36 | `Case_ID` | 100.0% | 3847 distinct (too many to list) | yes |
| 37 | `Claimant_String` | 98.5% | 3866 distinct (too many to list) | no |
| 38 | `Instructions` | 0.3% | NULL (3963); Property owner (2); Tenant (1); Need data from Jerry.   (1); Landlord (1); Ken Robbins (1); F 8450 (1); F 7032  (1); Contact is Bonnie Jarek bonnie.jarek@24heatingcooling.com (1); Contact McKenzie Miller 574-941-2181 (1); Case settled in mediation  (1);  (1) | yes |
| 39 | `ClaimantWorkExt` | 0.2% | NULL (3967); 395-1326 (2); 939-3972 (1); 746-5731 (1); 574-3834 (1); 483-1775 (1); 474-3207 (1); 297 (1) | no |

## Join_Case_Attorneys (534 rows, 18 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (534) | no |
| 2 | `FC` | 0.0% | NULL (534) | no |
| 3 | `One` | 100.0% | 1 (534) | no |
| 4 | `PK_ID#` | 100.0% | 534 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (534) | no |
| 6 | `RC` | 0.0% | NULL (534) | no |
| 7 | `G_Text` | 0.0% | NULL (534) | no |
| 8 | `G_Num` | 0.0% | NULL (534) | no |
| 9 | `Serial_#` | 100.0% | 534 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (534) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (534) | no |
| 12 | `Index` | 0.0% | NULL (534) | no |
| 13 | `G_Index` | 0.0% | NULL (534) | no |
| 14 | `Project_ID` | 100.0% | 517 distinct (too many to list) | no |
| 15 | `lawfirm_id` | 22.3% | 88 distinct (too many to list) | no |
| 16 | `attorney_id` | 27.9% | 113 distinct (too many to list) | no |
| 17 | `Role` | 0.4% | NULL (532); Plaintiff (1); Defendant (1) | yes |
| 18 | `Notes` | 9.4% | 32 distinct (too many to list) | yes |

## Join_Case_Experts (666 rows, 18 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (666) | no |
| 2 | `FC` | 0.0% | NULL (666) | no |
| 3 | `One` | 100.0% | 1 (666) | no |
| 4 | `PK_ID#` | 100.0% | 666 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (666) | no |
| 6 | `RC` | 0.0% | NULL (666) | no |
| 7 | `G_Text` | 0.0% | NULL (666) | no |
| 8 | `G_Num` | 0.0% | NULL (666) | no |
| 9 | `Serial_#` | 100.0% | 666 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (666) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (666) | no |
| 12 | `Index` | 0.0% | NULL (666) | no |
| 13 | `G_Index` | 0.0% | NULL (666) | no |
| 14 | `Case_ID` | 100.0% | 523 distinct (too many to list) | yes |
| 15 | `Expert_id` | 99.4% | 500 distinct (too many to list) | no |
| 16 | `ExpertFirm_id` | 74.5% | 330 distinct (too many to list) | no |
| 17 | `Role` | 0.0% | NULL (666) | yes |
| 18 | `Notes` | 1.1% | NULL (659); dhuff@forensicsg.com 5154 65th Street Indianapolis, IN   ... (1); Scott Dillon Exponent  630-658-7500 (1); Metallurgist (1); Matt Elliot at GAI did the inspection (1); Large building 60 X 80 Sony Li-ion batteries  (1); Cell  502-641-0224 (1); 313-600-6402 (1) | yes |

## Depositions (9 rows, 20 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (9) | no |
| 2 | `FC` | 0.0% | NULL (9) | no |
| 3 | `One` | 100.0% | 1 (9) | no |
| 4 | `PK_ID#` | 100.0% | 108-446936-012715 (1); 107-311504-121411 (1); 106-628914-010711 (1); 105-643896-031811 (1); 104-978525-031811 (1); 103-384564-031811 (1); 102-726296-022411 (1); 101-004692-022411 (1); 100-704824-022411 (1) | no |
| 5 | `R#` | 0.0% | NULL (9) | no |
| 6 | `RC` | 0.0% | NULL (9) | no |
| 7 | `G_Text` | 0.0% | NULL (9) | no |
| 8 | `G_Num` | 0.0% | NULL (9) | no |
| 9 | `Serial_#` | 100.0% | 108 (1); 107 (1); 106 (1); 105 (1); 104 (1); 103 (1); 102 (1); 101 (1); 100 (1) | no |
| 10 | `Filter` | 0.0% | NULL (9) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (9) | no |
| 12 | `Index` | 0.0% | NULL (9) | no |
| 13 | `G_Index` | 0.0% | NULL (9) | no |
| 14 | `Case_id` | 88.9% | F 2834 (2); 5007-663454-022411 (2); F 6041 (1); F 5128 (1); F 3841 (1); F 2571 (1); NULL (1) | yes |
| 15 | `part_id` | 0.0% | NULL (9) | no |
| 16 | `Deposition` | 55.6% | NULL (4); Reviewing case history (1); Political Infighting (1); Investigator (1); Event History (1); Dangers of filtration systems (1) | no |
| 17 | `Date` | 66.7% | NULL (3); 12/15/2010 (2); 1/15/2011 (2); 12/18/2010 (1); 1/16/2011 (1) | no |
| 18 | `Location` | 33.3% | NULL (6); Cabinet B (2); Aisle V (1) | yes |
| 19 | `Deposee` | 66.7% | NULL (3); Bill Smith (2); Roger Aisles (1); Richard Brown (1); John Smith (1); John Brown (1) | no |
| 20 | `Display` | 88.9% | F 6041 -  -  (1); F 5128 -  -  (1); F 3841 - John Brown -  (1); F 2834 - Bill Smith - Reviewing case history (1); F 2834 - Bill Smith - Dangers of filtration systems (1); F 2571 - Roger Aisles - Political Infighting (1); 5007-663454-022411 - Richard Brown - Investigator (1); 5007-663454-022411 - John Smith - Event History (1); NULL (1) | no |

## Expenses (23,869 rows, 44 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (23869) | no |
| 2 | `FC` | 0.0% | NULL (23869) | no |
| 3 | `One` | 100.0% | 1 (23869) | no |
| 4 | `PK_ID#` | 28.8% | 6873 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (23869) | no |
| 6 | `RC` | 0.0% | NULL (23869) | no |
| 7 | `G_Text` | 0.0% | NULL (23869) | no |
| 8 | `G_Num` | 0.0% | NULL (23869) | no |
| 9 | `Serial_#` | 100.0% | 23869 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (23869) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (23869) | no |
| 12 | `Index` | 0.0% | NULL (23869) | no |
| 13 | `G_Index` | 0.0% | NULL (23869) | no |
| 14 | `client_id` | 0.0% | NULL (23869) | no |
| 15 | `case_id` | 100.0% | 2010 distinct (too many to list) | yes |
| 16 | `Expense_ID` | 0.2% | 26 distinct (too many to list) | no |
| 17 | `part_id` | 0.0% | NULL (23869) | no |
| 18 | `staff_id` | 100.0% | 105-040087-121311 (20065); 107-667368-121311 (3268); 106-154432-121311 (492); 103-728974-031811 (27); 108-718036-121311 (17) | yes |
| 19 | `Note` | 0.0% | NULL (23869) | no |
| 20 | `Minutes` | 0.0% | NULL (23869) | no |
| 21 | `HourlyRate` | 99.8% | 29 distinct (too many to list) | no |
| 22 | `ExpenseAmt` | 51.6% | 5697 distinct (too many to list) | no |
| 23 | `Date` | 100.0% | 3639 distinct (too many to list) | no |
| 24 | `Location` | 99.9% | 135 distinct (too many to list) | yes |
| 25 | `Hours` | 48.6% | 81 distinct (too many to list) | yes |
| 26 | `Total` | 100.0% | 6611 distinct (too many to list) | no |
| 27 | `S_Total` | 0.0% | NULL (23869) | no |
| 28 | `category` | 100.0% | Expense (12291); Time (11544); NULL (11); Expense Expense Expense Expense (7); TIme (6); time (1); expense (1); Travel Time (1); Tolls (1); Tme (1); Time Time Time (1); Review (1); Hotel (1); Gasoline (1); Expense  (1) | yes |
| 29 | `Proceesed` | 99.9% | 660 distinct (too many to list) | no |
| 30 | `Multiplier` | 100.0% | 690 distinct (too many to list) | yes |
| 31 | `MultipliedExpenses` | 100.0% | 6357 distinct (too many to list) | no |
| 32 | `Invoice#` | 99.9% | 2757 distinct (too many to list) | no |
| 33 | `G_Case#` | 0.0% | NULL (23869) | no |
| 34 | `G_Invoice` | 0.0% | NULL (23869) | no |
| 35 | `Inv_Date` | 0.0% | NULL (23869) | no |
| 36 | `G_InvoiceDate` | 0.0% | NULL (23869) | no |
| 37 | `DEscription` | 99.9% | 454 distinct (too many to list) | yes |
| 38 | `G_Start_Date` | 0.0% | NULL (23869) | no |
| 39 | `G_End_Date` | 0.0% | NULL (23869) | no |
| 40 | `G_StaffiD` | 0.0% | NULL (23869) | no |
| 41 | `Year` | 100.0% | 2019 (2001); 2018 (1900); 2025 (1849); 2015 (1843); 2016 (1776); 2014 (1648); 2017 (1601); 2012 (1590); 2022 (1563); 2024 (1560); 2023 (1418); 2013 (1359); 2021 (1310); 2026 (1204); 2020 (1040); 2011 (195); NULL (11); 15 (1) | no |
| 42 | `Month` | 100.0% | 2 (2194); 1 (2157); 7 (2097); 3 (2068); 4 (2067); 11 (2064); 10 (2042); 5 (1994); 8 (1895); 9 (1845); 12 (1763); 6 (1672); NULL (11) | no |
| 43 | `Month_Name` | 100.0% | February (2194); January (2157); July (2097); March (2068); April (2067); November (2064); October (2042); May (1994); August (1895); September (1845); December (1763); June (1672); NULL (11) | no |
| 44 | `S_Hours` | 0.0% | NULL (23869) | no |

## ExpenseItems (60 rows, 5 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `Description` | 100.0% | 60 distinct (too many to list) | yes |
| 2 | `Category` | 100.0% | Time (30); Expense (30) | yes |
| 3 | `Serial_#` | 100.0% | 60 distinct (too many to list) | no |
| 4 | `PK_ID` | 100.0% | 60 distinct (too many to list) | no |
| 5 | `zz.BackMagic.cr` | 0.0% | NULL (60) | no |

## Attorneys (485 rows, 18 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (485) | no |
| 2 | `FC` | 0.0% | NULL (485) | no |
| 3 | `One` | 100.0% | 1 (485) | no |
| 4 | `PK_ID#` | 100.0% | 483 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (485) | no |
| 6 | `RC` | 0.0% | NULL (485) | no |
| 7 | `G_Text` | 0.0% | NULL (485) | no |
| 8 | `G_Num` | 0.0% | NULL (485) | no |
| 9 | `Serial_#` | 100.0% | 465 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (485) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (485) | no |
| 12 | `Index` | 0.0% | NULL (485) | no |
| 13 | `G_Index` | 0.0% | NULL (485) | no |
| 14 | `Lawfirm_id` | 66.0% | 236 distinct (too many to list) | no |
| 15 | `FirstName` | 74.0% | 189 distinct (too many to list) | no |
| 16 | `LastName` | 93.8% | 416 distinct (too many to list) | no |
| 17 | `C_Name` | 97.5% | 434 distinct (too many to list) | no |
| 18 | `Position` | 2.1% | NULL (475); Attorney (3); Associate (2); attorney - Plaintiff (1); Senior Litigator (1); Plaintiff Attorney (1); Partner (1); Paralegal (1) | no |

## Experts (652 rows, 24 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (652) | no |
| 2 | `FC` | 0.0% | NULL (652) | no |
| 3 | `One` | 100.0% | 1 (652) | no |
| 4 | `PK_ID#` | 100.0% | 652 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (652) | no |
| 6 | `RC` | 0.0% | NULL (652) | no |
| 7 | `G_Text` | 0.0% | NULL (652) | no |
| 8 | `G_Num` | 0.0% | NULL (652) | no |
| 9 | `Serial_#` | 100.0% | 652 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (652) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (652) | no |
| 12 | `Index` | 0.0% | NULL (652) | no |
| 13 | `G_Index` | 0.0% | NULL (652) | no |
| 14 | `ExpertFirm_id` | 61.5% | 302 distinct (too many to list) | no |
| 15 | `destination_id` | 0.0% | NULL (652) | no |
| 16 | `order_id` | 0.0% | NULL (652) | no |
| 17 | `part_id` | 0.0% | NULL (652) | no |
| 18 | `FirstName` | 81.4% | 221 distinct (too many to list) | no |
| 19 | `LastName` | 99.2% | 546 distinct (too many to list) | no |
| 20 | `Name` | 99.2% | 604 distinct (too many to list) | no |
| 21 | `Expert` | 100.0% | Expert (652) | no |
| 22 | `EMail` | 0.0% | NULL (652) | yes |
| 23 | `Contact#s` | 0.0% | NULL (652) | no |
| 24 | `Contact#s_Copy` | 0.0% | NULL (652) | no |

## LawFirms (262 rows, 15 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (262) | no |
| 2 | `FC` | 0.0% | NULL (262) | no |
| 3 | `One` | 100.0% | 1 (262) | no |
| 4 | `PK_ID#` | 100.0% | 262 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (262) | no |
| 6 | `RC` | 0.0% | NULL (262) | no |
| 7 | `G_Text` | 0.0% | NULL (262) | no |
| 8 | `G_Num` | 0.0% | NULL (262) | no |
| 9 | `Serial_#` | 100.0% | 262 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (262) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (262) | no |
| 12 | `Index` | 100.0% | C (47); B (27); S (21); L (21); W (19); G (19); H (18); M (13); F (13); T (9); K (9); D (9); R (7); J (6); N (5); P (4); O (4); Y (3); h (2); Q (2); E (2); V (1); I (1) | no |
| 13 | `G_Index` | 0.0% | NULL (262) | no |
| 14 | `Name` | 100.0% | 231 distinct (too many to list) | no |
| 15 | `ListPhones` | 0.0% | NULL (262) | no |

## Companies (1,321 rows, 34 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (1321) | no |
| 2 | `FC` | 0.0% | NULL (1321) | no |
| 3 | `One` | 100.0% | 1 (1321) | no |
| 4 | `PK_ID#` | 100.0% | 1321 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (1321) | no |
| 6 | `RC` | 0.0% | NULL (1321) | no |
| 7 | `G_Text` | 0.0% | NULL (1321) | no |
| 8 | `G_Num` | 0.0% | NULL (1321) | no |
| 9 | `Serial_#` | 100.0% | 1028 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (1321) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (1321) | no |
| 12 | `Index` | 0.0% | NULL (1321) | no |
| 13 | `G_Index` | 0.0% | NULL (1321) | no |
| 14 | `customer_id` | 0.0% | NULL (1321) | no |
| 15 | `destination_id` | 0.0% | NULL (1321) | no |
| 16 | `order_id` | 0.0% | NULL (1321) | no |
| 17 | `part_id` | 0.0% | NULL (1321) | no |
| 18 | `Client_Company` | 95.0% | 1182 distinct (too many to list) | no |
| 19 | `G_City` | 0.0% | NULL (1321) | no |
| 20 | `Category` | 77.4% | Client (414); Expert (327); NULL (298); Manufacturer (236); expert (43); Investigator (2); Attorney (1) | yes |
| 21 | `Closed` | 100.0% | Closed Inactive (1321) | no |
| 22 | `Active` | 100.0% | Active (1321) | no |
| 23 | `Closed_cases` | 0.0% | NULL (1321) | no |
| 24 | `Active_cases` | 0.0% | NULL (1321) | no |
| 25 | `HasActive` | 0.0% | NULL (1321) | no |
| 26 | `HasClosed` | 0.0% | NULL (1321) | no |
| 27 | `#_Contacts` | 0.0% | NULL (1321) | no |
| 28 | `cDisplayText` | 0.0% | NULL (1321) | no |
| 29 | `Open_Cases` | 0.0% | NULL (1321) | no |
| 30 | `IsClient` | 0.0% | NULL (1321) | no |
| 31 | `Last5Active_Cases` | 0.0% | NULL (1321) | no |
| 32 | `Active_Case_List` | 0.0% | NULL (1321) | no |
| 33 | `Old` | 78.4% | 1 (1036); NULL (285) | no |
| 34 | `AddRess_string` | 0.0% | NULL (1321) | no |

## Staff (4 rows, 19 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (4) | no |
| 2 | `FC` | 0.0% | NULL (4) | no |
| 3 | `One` | 100.0% | 1 (4) | no |
| 4 | `Staff_ID#` | 100.0% | 108-718036-121311 (1); 107-667368-121311 (1); 106-154432-121311 (1); 105-040087-121311 (1) | no |
| 5 | `R#` | 0.0% | NULL (4) | no |
| 6 | `RC` | 0.0% | NULL (4) | no |
| 7 | `G_Text` | 0.0% | NULL (4) | no |
| 8 | `G_Num` | 0.0% | NULL (4) | no |
| 9 | `Serial_#` | 100.0% | 108 (1); 107 (1); 106 (1); 105 (1) | no |
| 10 | `Filter` | 0.0% | NULL (4) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (4) | no |
| 12 | `Index` | 0.0% | NULL (4) | no |
| 13 | `G_Index` | 0.0% | NULL (4) | no |
| 14 | `FirstName` | 100.0% | Landon (1); Kristi (1); Jim  (1); James (1) | no |
| 15 | `Last_Name` | 100.0% | Miller (2); Finneran (1); Brown (1) | yes |
| 16 | `C_Name` | 100.0% | Landon Brown (1); Kristi Miller (1); Jim  Finneran (1); James Miller (1) | no |
| 17 | `HourlyRate` | 100.0% | 75.00 (1); 285.00 (1); 275 (1); 150 (1) | no |
| 18 | `Initials` | 100.0% | LKB (1); KDM (1); JVM (1); JMF (1) | no |
| 19 | `Active` | 100.0% | 1 (3); 0 (1) | no |

## Addresses (2,224 rows, 35 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (2224) | no |
| 2 | `FC` | 0.0% | NULL (2224) | no |
| 3 | `One` | 100.0% | 1 (2224) | no |
| 4 | `PK_ID#` | 88.0% | 1958 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (2224) | no |
| 6 | `RC` | 0.0% | NULL (2224) | no |
| 7 | `G_Text` | 0.0% | NULL (2224) | no |
| 8 | `G_Num` | 0.0% | NULL (2224) | no |
| 9 | `Serial_#` | 88.0% | 1958 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (2224) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (2224) | no |
| 12 | `Index` | 0.0% | NULL (2224) | no |
| 13 | `G_Index` | 0.0% | NULL (2224) | no |
| 14 | `customer_id` | 0.0% | NULL (2224) | no |
| 15 | `destination_id` | 0.0% | NULL (2224) | no |
| 16 | `order_id` | 0.0% | NULL (2224) | no |
| 17 | `part_id` | 0.0% | NULL (2224) | no |
| 18 | `ComapnyID` | 58.7% | 640 distinct (too many to list) | no |
| 19 | `Address` | 76.0% | 1288 distinct (too many to list) | no |
| 20 | `City` | 80.6% | 555 distinct (too many to list) | yes |
| 21 | `State` | 80.0% | 59 distinct (too many to list) | yes |
| 22 | `Zip` | 74.4% | 872 distinct (too many to list) | no |
| 23 | `G_ClientID` | 0.0% | NULL (2224) | no |
| 24 | `AddressID` | 29.1% | 642 distinct (too many to list) | no |
| 25 | `Office` | 100.0% | Office (2224) | no |
| 26 | `Contact_ID` | 67.4% | 1260 distinct (too many to list) | yes |
| 27 | `Category` | 23.4% | NULL (1703); Business (520); Personal (1) | yes |
| 28 | `LawFirmID` | 0.0% | NULL (2224) | no |
| 29 | `cDisplayText` | 0.0% | NULL (2224) | no |
| 30 | `City_State` | 81.2% | 614 distinct (too many to list) | no |
| 31 | `Address_String` | 100.0% | 1490 distinct (too many to list) | no |
| 32 | `CAddress` | 81.3% | 1489 distinct (too many to list) | no |
| 33 | `P_O_Box_#` | 0.0% | NULL (2224) | no |
| 34 | `Case_ID` | 0.0% | NULL (2224) | yes |
| 35 | `ExpertID` | 29.4% | 493 distinct (too many to list) | no |

## AnotherTable (11 rows, 5 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `AnotherTableSerialID` | 100.0% | AT00011 (1); AT00010 (1); AT00009 (1); AT00008 (1); AT00007 (1); AT00006 (1); AT00005 (1); AT00004 (1); AT00003 (1); AT00002 (1); AT00001 (1) | no |
| 2 | `OneTableID_Key` | 100.0% | OT00002 (4); OT00003 (3); OT00001 (3); OT00004 (1) | no |
| 3 | `Something` | 100.0% | Tabby (1); Siamese (1); Persian (1); Mandrill (1); Golden Retriever (1); Gibbon (1); Chimpanzee (1); Beagle (1); Basset Hound (1); Are there more than 1 kind of badger? (1); Alley (1) | no |
| 4 | `SomethingElse` | 27.3% | NULL (8); actually an ape (2); actually an old world monkey (1) | no |
| 5 | `zz.BackMagic.cr` | 0.0% | NULL (11) | no |

## Contact_#s (6,713 rows, 31 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (6713) | no |
| 2 | `FC` | 0.0% | NULL (6713) | no |
| 3 | `One` | 100.0% | 1 (6713) | no |
| 4 | `PK_ID#` | 100.0% | 6713 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (6713) | no |
| 6 | `RC` | 0.0% | NULL (6713) | no |
| 7 | `G_Text` | 0.0% | NULL (6713) | no |
| 8 | `G_Num` | 0.0% | NULL (6713) | no |
| 9 | `Serial_#` | 100.0% | 6713 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (6713) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (6713) | no |
| 12 | `Index` | 0.0% | NULL (6713) | no |
| 13 | `G_Index` | 0.0% | NULL (6713) | no |
| 14 | `ClientID` | 25.1% | 409 distinct (too many to list) | no |
| 15 | `AddressID` | 23.7% | 525 distinct (too many to list) | no |
| 16 | `ContactID` | 37.0% | 1242 distinct (too many to list) | no |
| 17 | `Extension` | 2.6% | 134 distinct (too many to list) | yes |
| 18 | `Category` | 98.9% | Office (1809); Fax (1495); Cell (690); Direct (680); Toll_free (527); Home (506); pager (487); Business (372); NULL (74); Toll-Free (30); mobile (22); fax (4); cell (4); business (2); Work (2); Personal (2); Main (2); office (1); Pager (1); Mobile (1); 87369 (1); 289 (1) | yes |
| 19 | `F_Number` | 58.5% | 2891 distinct (too many to list) | no |
| 20 | `DuplicateCheck` | 58.7% | 3596 distinct (too many to list) | no |
| 21 | `Mark` | 0.0% | NULL (6713) | no |
| 22 | `Contact_Type` | 100.0% | Attorney (3388); Client (2484); Expert (657); Company (184) | no |
| 23 | `LawyerID` | 50.5% | 410 distinct (too many to list) | no |
| 24 | `Client` | 0.0% | NULL (6713) | no |
| 25 | `Contact` | 0.0% | NULL (6713) | no |
| 26 | `PhoneNumber` | 58.5% | 2891 distinct (too many to list) | no |
| 27 | `NumberString` | 58.7% | 2955 distinct (too many to list) | no |
| 28 | `Primary` | 0.0% | NULL (6713) | no |
| 29 | `City` | 0.1% | NULL (6706); 100-924298-121210 (3); 748-802162-012511 (2); Hammond (1); 749-259665-012511 (1) | yes |
| 30 | `PhoneNumberString` | 99.9% | 3057 distinct (too many to list) | no |
| 31 | `Expertid` | 9.8% | 339 distinct (too many to list) | no |

## EMails (540 rows, 19 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (540) | no |
| 2 | `FC` | 0.0% | NULL (540) | no |
| 3 | `One` | 100.0% | 1 (540) | no |
| 4 | `PK_ID#` | 100.0% | 540 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (540) | no |
| 6 | `RC` | 0.0% | NULL (540) | no |
| 7 | `G_Text` | 0.0% | NULL (540) | no |
| 8 | `G_Num` | 0.0% | NULL (540) | no |
| 9 | `Serial_#` | 100.0% | 540 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (540) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (540) | no |
| 12 | `Index` | 0.0% | NULL (540) | no |
| 13 | `G_Index` | 0.0% | NULL (540) | no |
| 14 | `company_id` | 2.0% | NULL (529); 1054-926731-121310 (2); 397 (1); 1648-033736-013124 (1); 1591-896768-004418 (1); 1431-825216-032812 (1); 1408-835214-121511 (1); 1407-666512-121311 (1); 1293-474364-012511 (1); 1055-049176-121310 (1); 100 (1) | no |
| 15 | `contact_id` | 98.5% | 530 distinct (too many to list) | yes |
| 16 | `EMail` | 99.3% | 517 distinct (too many to list) | yes |
| 17 | `Category` | 83.3% | Business (447); NULL (90); business (2); Office (1) | yes |
| 18 | `LawFirmID` | 0.0% | NULL (540) | no |
| 19 | `C_Email` | 99.4% | 521 distinct (too many to list) | no |

## Electro_Tek (4 rows, 24 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `Closed` | 100.0% | Closed Inactive (4) | no |
| 2 | `Active` | 100.0% | Active (4) | no |
| 3 | `InActive` | 100.0% | InActive (4) | no |
| 4 | `ActiveCount` | 0.0% | NULL (4) | no |
| 5 | `ClosedCount` | 0.0% | NULL (4) | no |
| 6 | `zz.BackMagic.cr` | 0.0% | NULL (4) | no |
| 7 | `Icons` | 0.0% | NULL (4) | no |
| 8 | `G_Case#` | 0.0% | NULL (4) | no |
| 9 | `Category` | 100.0% | Client (4) | yes |
| 10 | `Clients_Filter` | 75.0% | ba (3); NULL (1) | no |
| 11 | `G_ClientCode` | 0.0% | NULL (4) | no |
| 12 | `G_CaseStatus` | 0.0% | NULL (4) | no |
| 13 | `G_Product` | 0.0% | NULL (4) | no |
| 14 | `Product_filter` | 75.0% | coff (3); NULL (1) | no |
| 15 | `Contact_filter` | 75.0% | br (3); NULL (1) | no |
| 16 | `G_ContactCode` | 0.0% | NULL (4) | no |
| 17 | `G_Upgrade` | 0.0% | NULL (4) | no |
| 18 | `Import_Sttus` | 0.0% | NULL (4) | no |
| 19 | `One` | 100.0% | 1 (4) | no |
| 20 | `G_NewVersion` | 0.0% | NULL (4) | no |
| 21 | `G_AccountName` | 0.0% | NULL (4) | no |
| 22 | `G_Accountid` | 0.0% | NULL (4) | no |
| 23 | `G_Layoutobjects` | 0.0% | NULL (4) | no |
| 24 | `EffectiveDate` | 100.0% | 12/10/2011 (4) | no |

## Interface (0 rows, 35 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `IntBlueFadeGlob` | 0.0% | (table empty) | no |
| 2 | `IntBlueFillGlob` | 0.0% | (table empty) | no |
| 3 | `IntBlueHeaderLongGlob` | 0.0% | (table empty) | no |
| 4 | `IntContTab1Glob` | 0.0% | (table empty) | no |
| 5 | `IntContTab1IconActiveGlob` | 0.0% | (table empty) | no |
| 6 | `IntContTab1IconDimGlob` | 0.0% | (table empty) | no |
| 7 | `IntContTab1NameGlob` | 0.0% | (table empty) | no |
| 8 | `IntContTab2Glob` | 0.0% | (table empty) | no |
| 9 | `IntContTab2IconActiveGlob` | 0.0% | (table empty) | no |
| 10 | `IntContTab2IconDimGlob` | 0.0% | (table empty) | no |
| 11 | `IntContTab2NameGlob` | 0.0% | (table empty) | no |
| 12 | `IntContTab3Glob` | 0.0% | (table empty) | no |
| 13 | `IntContTab3IconActiveGlob` | 0.0% | (table empty) | no |
| 14 | `IntContTab3IconDimGlob` | 0.0% | (table empty) | no |
| 15 | `IntContTab3NameGlob` | 0.0% | (table empty) | no |
| 16 | `IntContTab4Glob` | 0.0% | (table empty) | no |
| 17 | `IntContTab4IconActiveGlob` | 0.0% | (table empty) | no |
| 18 | `IntContTab4IconDimGlob` | 0.0% | (table empty) | no |
| 19 | `IntContTab4NameGlob` | 0.0% | (table empty) | no |
| 20 | `IntCurveLogoGlob` | 0.0% | (table empty) | no |
| 21 | `IntCurveNoLogoGlob` | 0.0% | (table empty) | no |
| 22 | `IntCurveWhiteGlob` | 0.0% | (table empty) | no |
| 23 | `IntGradientGlob` | 0.0% | (table empty) | no |
| 24 | `IntGreenFillGlob` | 0.0% | (table empty) | no |
| 25 | `IntPillWhiteGlob` | 0.0% | (table empty) | no |
| 26 | `IntTrashGlob` | 0.0% | (table empty) | no |
| 27 | `IntHatGlob` | 0.0% | (table empty) | no |
| 28 | `IntArrowGoGlob` | 0.0% | (table empty) | no |
| 29 | `IntBunnyInGlob` | 0.0% | (table empty) | no |
| 30 | `IntBunnyOutGlob` | 0.0% | (table empty) | no |
| 31 | `IntBunnyStateGlob` | 0.0% | (table empty) | no |
| 32 | `IntArrowBackLitGlob` | 0.0% | (table empty) | no |
| 33 | `IntArrowBackDimGlob` | 0.0% | (table empty) | no |
| 34 | `IntArrowFWDLitGlob` | 0.0% | (table empty) | no |
| 35 | `IntArrowFWDDimGlob` | 0.0% | (table empty) | no |

## Join_Cases_Contacts (2 rows, 19 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (2) | no |
| 2 | `FC` | 0.0% | NULL (2) | no |
| 3 | `One` | 100.0% | 1 (2) | no |
| 4 | `PK_ID#` | 100.0% | 101-606022-121310 (1); 100-429586-121310 (1) | no |
| 5 | `R#` | 0.0% | NULL (2) | no |
| 6 | `RC` | 0.0% | NULL (2) | no |
| 7 | `G_Text` | 0.0% | NULL (2) | no |
| 8 | `G_Num` | 0.0% | NULL (2) | no |
| 9 | `Serial_#` | 100.0% | 101 (1); 100 (1) | no |
| 10 | `Filter` | 0.0% | NULL (2) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (2) | no |
| 12 | `Index` | 0.0% | NULL (2) | no |
| 13 | `G_Index` | 0.0% | NULL (2) | no |
| 14 | `Case_id` | 100.0% | 3979-066746-121210 (2) | yes |
| 15 | `Client_id` | 0.0% | NULL (2) | no |
| 16 | `Contact_id` | 100.0% | 2072-215058-121310 (1); 2071-554392-121310 (1) | yes |
| 17 | `Role` | 0.0% | NULL (2) | yes |
| 18 | `Note` | 0.0% | NULL (2) | no |
| 19 | `Reference#` | 0.0% | NULL (2) | no |

## Library (1,061 rows, 46 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (1061) | no |
| 2 | `FC` | 0.0% | NULL (1061) | no |
| 3 | `One` | 100.0% | 1 (1061) | no |
| 4 | `PK_ID#` | 100.0% | 1061 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (1061) | no |
| 6 | `RC` | 0.0% | NULL (1061) | no |
| 7 | `G_Text` | 0.0% | NULL (1061) | no |
| 8 | `G_Num` | 0.0% | NULL (1061) | no |
| 9 | `Serial_#` | 100.0% | 1061 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (1061) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (1061) | no |
| 12 | `Index` | 0.0% | NULL (1061) | no |
| 13 | `G_Index` | 0.0% | NULL (1061) | no |
| 14 | `customer_id` | 0.0% | NULL (1061) | no |
| 15 | `destination_id` | 0.0% | NULL (1061) | no |
| 16 | `order_id` | 0.0% | NULL (1061) | no |
| 17 | `part_id` | 0.0% | NULL (1061) | no |
| 18 | `Articles` | 33.6% | 223 distinct (too many to list) | no |
| 19 | `Author` | 81.7% | 680 distinct (too many to list) | no |
| 20 | `Borrower_First_Name` | 0.0% | NULL (1061) | no |
| 21 | `Borrower_Last_Name` | 0.0% | NULL (1061) | no |
| 22 | `Category` | 81.8% | Reference (450); Technical (376); NULL (193); Reference Technical (36); Technical Reference (5); Management (1) | yes |
| 23 | `Check_out_Days` | 0.0% | NULL (1061) | no |
| 24 | `Date_Acquired` | 0.9% | NULL (1051); 6/19/2002 (10) | no |
| 25 | `Date_Check_In` | 0.0% | NULL (1061) | no |
| 26 | `Date_Check_Out` | 0.0% | NULL (1061) | no |
| 27 | `Date_Created` | 100.0% | 119 distinct (too many to list) | no |
| 28 | `Date_Due` | 0.0% | NULL (1061) | no |
| 29 | `Format` | 95.0% | Book (964); NULL (53); Booklet (25); book (5); Magazine (4); Newsletter (2); Book  (2); Tablet (1); Booket  (1); Booke (1); Book let (1); Book   (1); Binder (1) | no |
| 30 | `HiliteLibrary` | 0.0% | NULL (1061) | no |
| 31 | `HiliteMediaDateAcquired` | 0.0% | NULL (1061) | no |
| 32 | `HiliteMediaDueDate` | 0.0% | NULL (1061) | no |
| 33 | `HiliteMediaTitle` | 0.0% | NULL (1061) | no |
| 34 | `HiliteMediaType` | 0.0% | NULL (1061) | no |
| 35 | `HiliteSortedBy` | 0.0% | NULL (1061) | no |
| 36 | `ISBN` | 65.1% | 666 distinct (too many to list) | no |
| 37 | `Library_ID` | 100.0% | 1061 distinct (too many to list) | no |
| 38 | `Notes` | 0.0% | NULL (1061) | yes |
| 39 | `Overdue_Calc` | 0.0% | NULL (1061) | no |
| 40 | `Page_Number` | 0.0% | NULL (1061) | no |
| 41 | `Publisher` | 0.0% | NULL (1061) | no |
| 42 | `Template_Information_Global` | 0.0% | NULL (1061) | no |
| 43 | `Title` | 100.0% | 999 distinct (too many to list) | no |
| 44 | `Date_Published` | 94.3% | 87 distinct (too many to list) | no |
| 45 | `TK_Number` | 62.7% | 623 distinct (too many to list) | no |
| 46 | `Library_of_Congress` | 12.6% | 120 distinct (too many to list) | no |

## Manufacturers (570 rows, 17 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (570) | no |
| 2 | `FC` | 0.0% | NULL (570) | no |
| 3 | `One` | 100.0% | 1 (570) | no |
| 4 | `PK_ID#` | 100.0% | 570 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (570) | no |
| 6 | `RC` | 0.0% | NULL (570) | no |
| 7 | `G_Text` | 0.0% | NULL (570) | no |
| 8 | `G_Num` | 0.0% | NULL (570) | no |
| 9 | `Serial_#` | 100.0% | 307 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (570) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (570) | no |
| 12 | `Index` | 0.0% | NULL (570) | no |
| 13 | `G_Index` | 0.0% | NULL (570) | no |
| 14 | `Manufacturer` | 97.4% | 549 distinct (too many to list) | no |
| 15 | `Active` | 100.0% | Active (570) | no |
| 16 | `Closed` | 100.0% | Closed Inactive (570) | no |
| 17 | `OpenCases` | 0.0% | NULL (570) | no |

## OneTable (4 rows, 8 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (4) | no |
| 2 | `Field_A` | 100.0% | Monkeys (1); Dogs (1); Cats (1); Badgers (1) | no |
| 3 | `Field_B` | 0.0% | NULL (4) | no |
| 4 | `Field_C` | 0.0% | NULL (4) | no |
| 5 | `Field_D` | 0.0% | NULL (4) | no |
| 6 | `Field_E` | 0.0% | NULL (4) | no |
| 7 | `Field_F` | 0.0% | NULL (4) | no |
| 8 | `OneTableSerialID` | 100.0% | OT00004 (1); OT00003 (1); OT00002 (1); OT00001 (1) | no |

## Original_Data (4,082 rows, 507 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `Project_No.` | 100.0% | 4075 distinct (too many to list) | no |
| 2 | `Date` | 99.9% | 2267 distinct (too many to list) | no |
| 3 | `Status` | 99.9% | Closed  (1862); Closed (1652); Active  (492); Inactive (41); InActive (15); closed (6); Active (5); Closed   (4); NULL (4); CLosed (1) | yes |
| 4 | `CFirst_Nme` | 97.1% | 421 distinct (too many to list) | no |
| 5 | `CLst_Nme` | 97.3% | 775 distinct (too many to list) | no |
| 6 | `CTitle` | 1.7% | NULL (4011); Attorney (46); Adjuster (18); Ms. (2); Mr. (2); Ms (1); Mr (1); CRC (1) | no |
| 7 | `CCmpy_Nme` | 99.7% | 576 distinct (too many to list) | no |
| 8 | `CRequest` | 58.3% | 1348 distinct (too many to list) | no |
| 9 | `CAddress` | 95.6% | 690 distinct (too many to list) | no |
| 10 | `CCity` | 98.3% | 340 distinct (too many to list) | no |
| 11 | `CState` | 98.1% | 51 distinct (too many to list) | no |
| 12 | `CZip` | 91.2% | 531 distinct (too many to list) | no |
| 13 | `COffice_#` | 92.8% | 733 distinct (too many to list) | no |
| 14 | `CFax_AC` | 52.4% | 137 distinct (too many to list) | no |
| 15 | `CMobile_#` | 6.3% | 70 distinct (too many to list) | no |
| 16 | `CHome_#` | 1.5% | NULL (4022); 468-4469 (38); 248-0748 (4); 299-8406 (3); 588-5353 (2); 885-0807 (1); 782-5641 (1); 714-0344 (1); 686-4267 (1); 616-299 (1); 443-0415 (1); 436-5547 (1); 352-2346 (1); 277-7662 (1); 261-0670 (1); 253-3638 (1); 241-2466 (1); 226-2902 (1) | no |
| 17 | `CPager_#` | 0.0% | NULL (4081); 828-1526 (1) | no |
| 18 | `CDirect_#` | 7.4% | 83 distinct (too many to list) | no |
| 19 | `COffice_AC` | 85.1% | 149 distinct (too many to list) | no |
| 20 | `CFax_#` | 56.0% | 449 distinct (too many to list) | no |
| 21 | `CMobile_AC` | 6.3% | 42 distinct (too many to list) | no |
| 22 | `CHome_AC` | 1.5% | NULL (4022); 978 (38); 616 (8); 423 (2); 954 (1); 901 (1); 816 (1); 814 (1); 801 (1); 630 (1); 615 (1); 601 (1); 508 (1); 419 (1); 317 (1); 256 (1) | no |
| 23 | `CPager_AC` | 0.0% | NULL (4081); 812 (1) | no |
| 24 | `CDirect_AC` | 7.2% | 42 distinct (too many to list) | no |
| 25 | `CFax_EX` | 0.4% | NULL (4065); 3729 (17) | no |
| 26 | `COffice_EX` | 5.1% | 69 distinct (too many to list) | no |
| 27 | `CMobile_EX` | 0.0% | NULL (4082) | no |
| 28 | `CHome_EX` | 0.0% | NULL (4081); 8406 (1) | no |
| 29 | `CPager_EX` | 0.0% | NULL (4082) | no |
| 30 | `CDirect_EX` | 0.1% | NULL (4076); Karen (3); 8981 (2); Debbie (1) | no |
| 31 | `CCase_#` | 35.9% | 1430 distinct (too many to list) | no |
| 32 | `CFile_#` | 13.2% | 480 distinct (too many to list) | no |
| 33 | `CClain_#` | 34.0% | 1350 distinct (too many to list) | no |
| 34 | `CIdentifier` | 78.1% | 284 distinct (too many to list) | no |
| 35 | `CToll__AC` | 4.0% | NULL (3920); 800 (105); 888 (50); 877 (3); 866 (3); 800  (1) | no |
| 36 | `CToll__#` | 4.0% | NULL (3920); 828-4000 (79); 456-7445 (38); 227-2757 (17); 898-6216 (8); 551-0700 (2); 326-6034 (2); 225-5529 (2); 215-7075 (2); 876-2462 (1); 782-6424 (1); 762-3575 (1); 656-8005 (1); 576-8681 (1); 483-2472 (1); 457-8276 (1); 454-3400 (1); 271-8486 (1); 252-4601 (1); 242-2418 (1); 222-7623 (1) | no |
| 37 | `CToll__EX` | 2.6% | NULL (3974); 3094 (72); 5244 (9); 3428 (7); 5530 (4); 5524 (2); 3729 (2); 3343 (2); TM 60 (1); 8545 (1); 5358 (1); 5313 (1); 3422 (1); 3093 (1); 3087 (1); 2714 (1); 2519 (1); 225 (1) | no |
| 38 | `PManufacturer` | 50.4% | 324 distinct (too many to list) | no |
| 39 | `PProduct` | 83.9% | 1078 distinct (too many to list) | no |
| 40 | `PModel#` | 38.2% | 869 distinct (too many to list) | no |
| 41 | `PSerial#` | 3.8% | 152 distinct (too many to list) | no |
| 42 | `PDateRecv` | 0.5% | NULL (4061); 10/5/2004 (3); 7/30/2002 (2); 9/9/2009 (1); 9/5/2002 (1); 9/13/2002 (1); 8/28/2002 (1); 8/12/2002 (1); 7/22/2002 (1); 7/10/2002 (1); 6/11/2003 (1); 5/12/2003 (1); 3/27/2004 (1); 3/11/2003 (1); 12/12/2002 (1); 11/19/2003 (1); 10/11/2004 (1); 10/10/2006 (1); 1/8/2003 (1) | no |
| 43 | `PPhotos` | 0.3% | NULL (4070); Yes (12) | no |
| 44 | `CL_Lstnme` | 65.5% | 2304 distinct (too many to list) | no |
| 45 | `CL_Frtnme` | 49.6% | 1104 distinct (too many to list) | no |
| 46 | `CL_Adress` | 49.0% | 1983 distinct (too many to list) | no |
| 47 | `CL_City` | 51.8% | 1516 distinct (too many to list) | no |
| 48 | `CL_State` | 52.6% | 77 distinct (too many to list) | no |
| 49 | `CL_Zip` | 35.6% | 1356 distinct (too many to list) | no |
| 50 | `CL_Home_AC` | 8.5% | 157 distinct (too many to list) | no |
| 51 | `CL_Home_#` | 23.6% | 918 distinct (too many to list) | no |
| 52 | `CL_Home_EX` | 0.1% | NULL (4078); mother (1); Todd B (1); Janet (1); 30 (1) | no |
| 53 | `CL_Work_AC` | 1.6% | 54 distinct (too many to list) | no |
| 54 | `CL_Work_EX` | 1.5% | 61 distinct (too many to list) | no |
| 55 | `CL_Work_#` | 2.9% | 119 distinct (too many to list) | no |
| 56 | `I_Lstnme` | 32.2% | 1154 distinct (too many to list) | no |
| 57 | `I_Frtnme` | 23.1% | 633 distinct (too many to list) | no |
| 58 | `I_Address` | 18.7% | 765 distinct (too many to list) | no |
| 59 | `I_City` | 20.8% | 558 distinct (too many to list) | no |
| 60 | `I_State` | 21.9% | 46 distinct (too many to list) | no |
| 61 | `I_Zip` | 11.2% | 405 distinct (too many to list) | no |
| 62 | `I_Home_AC` | 3.9% | 48 distinct (too many to list) | no |
| 63 | `I_Home_#` | 5.3% | 210 distinct (too many to list) | no |
| 64 | `I_Home_EX` | 0.2% | NULL (4075); Parents (2); wife (1); hotel (1); Mother (1); Lisa (1); James (1) | no |
| 65 | `I_Work_AC` | 1.9% | 29 distinct (too many to list) | no |
| 66 | `I_Work_#` | 2.5% | 102 distinct (too many to list) | no |
| 67 | `I_Work_EX` | 0.1% | NULL (4077); insmom (1); PA  John (1); Mr.cell (1); Dad (1); 297 (1) | no |
| 68 | `D_Contact_date` | 0.4% | NULL (4065); 9/5/2002 (2); 6/9/2003 (2); 5/20/2003 (2); 8/30/2004 (1); 8/26/2002 (1); 8/18/2003 (1); 7/21/2003 (1); 6/30/2003 (1); 6/18/2007 (1); 3/10/2003 (1); 12/29/2006 (1); 10/29/2002 (1); 1/9/2004 (1); 1/11/2003 (1) | no |
| 69 | `D_Site_date` | 17.9% | 636 distinct (too many to list) | no |
| 70 | `D_Exam_date` | 21.5% | 773 distinct (too many to list) | no |
| 71 | `D_Followup_date` | 0.0% | NULL (4082) | no |
| 72 | `D_Report_date` | 11.0% | 331 distinct (too many to list) | no |
| 73 | `D_Depo_date` | 1.4% | 55 distinct (too many to list) | no |
| 74 | `D_Trial_date` | 0.6% | NULL (4057); 3/14/2001 (2); 9/27/2006 (1); 9/17/2001 (1); 8/6/1996 (1); 7/9/2003 (1); 7/8/2010 (1); 7/8/2009 (1); 6/5/1997 (1); 6/16/2003 (1); 5/25/2004 (1); 4/3/2001 (1); 3/27/2001 (1); 3/13/2002 (1); 2/5/1997 (1); 2/2/2001 (1); 2/18/1997 (1); 12/17/2001 (1); 11/25/2008 (1); 11/21/1996 (1); 11/13/2003 (1); 10/7/1997 (1); 10/31/2000 (1); 10/21/1996 (1); 1/27/1997 (1) | no |
| 75 | `D_Evidence_DispDate` | 6.0% | 151 distinct (too many to list) | no |
| 76 | `EDesctrip` | 11.4% | 466 distinct (too many to list) | no |
| 77 | `EStorage` | 4.2% | NULL (3912); Yes  (158); No (9); yes (1); NONE (1); DISCARD (1) | no |
| 78 | `ELocation` | 12.2% | NULL (3586); Shelving 1B (95); Upstairs (81); Lab (63); Shelving 2C (58); Shelving 2B (52); Shelving 1C (41); Large Storage (30); Shelving 1A (22); Shelving 2A (16); Shelving (16); Shelving 1D (13); Storage Shed (6); Shelving 3A (2); Upstairs - SCJ (1) | no |
| 79 | `EOther_location` | 0.3% | NULL (4069); Large Storage (7); Lab (3); Shelving 1B (2); Upstairs (1) | no |
| 80 | `EDispositionSent` | 6.4% | NULL (3822); Yes  (242); 1/28/2002 (7); No (3); 8/6/2001 (1); 7/16/2002 (1); 3/12/2002 (1); 2/2/2002 (1); 10/29/2001 (1); 1/9/2002 (1); 1/18/2002 (1); 1/10/2002 (1) | no |
| 81 | `EResponce` | 13.3% | NULL (3540); Discard (342); Retain  (83); Return  (58); Forward (41); DISCARD (9); DISCARD JMF (3); store non-billable (1); Retain (1); Discarded (1); DSICARD (1); DISCARDED JMF (1); DISCARDED (1) | no |
| 82 | `EResults` | 28.7% | 1053 distinct (too many to list) | no |
| 83 | `E#_of_peices` | 17.2% | NULL (3380); 1 (601); 2 (51); 3 (25); 4 (9); 6 (4); 8 (2); 7 (2); SEL (1); 9 (1); 5 (1); 2  (1); 11 (1); 10 (1); 1 of 1 (1); 1 Box  (1) | no |
| 84 | `EOhter#_of_peices` | 0.4% | NULL (4066); 1 (12); 2 (2); several (1); SEL (1) | no |
| 85 | `EDate_reciev` | 4.0% | 148 distinct (too many to list) | no |
| 86 | `E_action` | 10.2% | NULL (3664); Discarded  (315); Returned (61); Forward (40); Discarded (2) | no |
| 87 | `EAction_Date` | 10.0% | 148 distinct (too many to list) | no |
| 88 | `EInitials` | 10.3% | NULL (3663); JVM (247); jvm (102); MLA (33); KM (16); JMF (16); jmf (2); LKB (2); RF (1) | no |
| 89 | `EReturned_to` | 1.9% | 72 distinct (too many to list) | no |
| 90 | `EXray` | 0.5% | NULL (4063); Yes  (17); No (2) | no |
| 91 | `Exray_date` | 0.2% | NULL (4072); 2/26/2003 (2); 9/26/2002 (1); 8/21/2003 (1); 7/3/2002 (1); 7/28/2003 (1); 6/13/2003 (1); 3/19/2003 (1); 2/23/2005 (1); 12/22/2003 (1) | no |
| 92 | `DA_lstnme` | 11.5% | 378 distinct (too many to list) | no |
| 93 | `DA_Frtnme` | 9.5% | 178 distinct (too many to list) | no |
| 94 | `DA_Firm` | 7.6% | 236 distinct (too many to list) | no |
| 95 | `DA_Adress` | 7.3% | 249 distinct (too many to list) | no |
| 96 | `DA_City` | 7.4% | 144 distinct (too many to list) | no |
| 97 | `DA_State` | 7.3% | 38 distinct (too many to list) | no |
| 98 | `DA_Zip` | 7.0% | 178 distinct (too many to list) | no |
| 99 | `DAofficeAC` | 7.4% | 96 distinct (too many to list) | no |
| 100 | `Da_office#` | 7.4% | 215 distinct (too many to list) | no |
| 101 | `DA_officeEX` | 0.1% | NULL (4079); 425 (1); 4214 (1); 217 (1) | no |
| 102 | `DA_faxAC` | 5.5% | 85 distinct (too many to list) | no |
| 103 | `DA_fax_#` | 5.5% | 161 distinct (too many to list) | no |
| 104 | `DA_fax_EX` | 0.0% | NULL (4081); ~ (1) | no |
| 105 | `DA_mobileAC` | 0.4% | NULL (4066); 847 (4); 262 (2); 215 (2); 651 (1); 586 (1); 513 (1); 479 (1); 419 (1); 412 (1); 312 (1); 248 (1) | no |
| 106 | `DA_mobile_#` | 0.4% | NULL (4066); 452-0573 (3); 880-5991 (2); 961-2145 (1); 841-1516 (1); 721-0827 (1); 710-7710 (1); 703-6003 (1); 530-0992 (1); 401-7268 (1); 371-4724 (1); 280-5690 (1); 264-2190 (1); -2149-4041 (1) | no |
| 107 | `DA_mobile_EX` | 0.0% | NULL (4082) | no |
| 108 | `DA_HomeAC` | 0.1% | NULL (4078); 800 (2); 262 (2) | no |
| 109 | `DA_home#` | 0.1% | NULL (4078); 752-9612 (2); 523-2900 (1); 448-1207 (1) | no |
| 110 | `DA_homeEX` | 0.0% | NULL (4082) | no |
| 111 | `DA_pagerAC` | 0.0% | NULL (4082) | no |
| 112 | `DA_pager_#` | 0.0% | NULL (4082) | no |
| 113 | `DA_Pager_EX` | 0.0% | NULL (4082) | no |
| 114 | `DA_Direct_AC` | 1.3% | 28 distinct (too many to list) | no |
| 115 | `DA_Direct_#` | 1.3% | 52 distinct (too many to list) | no |
| 116 | `Da_Direct_EX` | 0.0% | NULL (4081); 9 (1) | no |
| 117 | `DA_tollfree_AC` | 0.4% | NULL (4064); 800 (10); 877 (6); 888 (2) | no |
| 118 | `DA_tollfree#` | 0.4% | NULL (4064); 992-6036 (4); 448-1207 (2); 423-1950 (2); 244-1400 (2); 967-7100 (1); 890-1393 (1); 704-0040 (1); 579-1144 (1); 526-2898 (1); 523-2900 (1); 253-2900 (1); 215-7075 (1) | no |
| 119 | `DA_tollfree_EX` | 0.0% | NULL (4082) | no |
| 120 | `DA_Identifier` | 0.3% | NULL (4070); YCRT (1); TVKB (1); TF (1); OHL (1); KTS (1); HC (1); GS (1); G & D (1); EE (1); CS (1); BMC (1); BL (1) | no |
| 121 | `Da_notes` | 3.1% | 96 distinct (too many to list) | no |
| 122 | `B_stq1` | 1.2% | 49 distinct (too many to list) | no |
| 123 | `B_stq2` | 1.3% | 53 distinct (too many to list) | no |
| 124 | `B_stq3` | 1.6% | 64 distinct (too many to list) | no |
| 125 | `B_stq4` | 1.7% | 68 distinct (too many to list) | no |
| 126 | `B_stq1date` | 1.1% | NULL (4036); 4/13/2011 (12); 4/4/2007 (6); 3/15/2002 (5); 7/13/2005 (4); 4/7/2010 (3); 4/1/2008 (3); 4/8/2009 (2); 7/11/2007 (1); 4/14/2011 (1); 3/25/2002 (1); 3/23/2002 (1); 3/18/2002 (1); 3/1/2011 (1); 3/1/2008 (1); 2/7/2007 (1); 12/7/2001 (1); 12/30/2008 (1); 10/1/2007 (1) | no |
| 127 | `B_stq2date` | 1.3% | NULL (4029); 7/2/2008 (15); 7/12/2002 (11); 7/19/2011 (9); 7/13/2005 (5); 7/11/2007 (4); 7/7/2010 (2); 7/5/2006 (2); 7/7/2008 (1); 7/1/2008 (1); 6/20/2011 (1); 12/14/2009 (1); 10/21/2009 (1) | no |
| 128 | `B_stq3date` | 1.6% | NULL (4018); 10/7/2008 (20); 10/9/2002 (10); 10/5/2005 (9); 10/12/2011 (9); 10/1/2007 (6); 10/4/2004 (2); 10/3/2006 (2); 1/3/2011 (2); 12/14/2009 (1); 11/8/2005 (1); 10/1/2008 (1); 1/28/2003 (1) | no |
| 129 | `B_stq4date` | 1.7% | NULL (4012); 1/22/2003 (17); 1/14/2009 (17); 1/9/2008 (15); 1/2/2006 (8); 1/2/2007 (3); 1/3/2011 (2); 7/12/2002 (1); 12/26/2002 (1); 12/14/2009 (1); 1/31/2006 (1); 1/28/2003 (1); 1/13/2010 (1); 1/12/2010 (1); 1/12/2005 (1) | no |
| 130 | `B_styear1` | 2.5% | NULL (3981); 2002 (23); 2007 (21); 2008 (19); 2011 (15); 2005 (9); 1/1/06 (4); 2010 (3); 2009 (3); 2006 (2); 2004 (2) | no |
| 131 | `B_stq1-2` | 1.2% | 51 distinct (too many to list) | no |
| 132 | `B_stq2-2` | 1.1% | 46 distinct (too many to list) | no |
| 133 | `B_stq3-2` | 1.1% | 42 distinct (too many to list) | no |
| 134 | `B_stq4-2` | 1.2% | 47 distinct (too many to list) | no |
| 135 | `B_stq1date-2` | 1.2% | NULL (4031); 4/23/2003 (19); 4/1/2008 (11); 4/8/2009 (10); 4/4/2007 (4); 7/13/2005 (2); 4/7/2010 (2); 4/13/2011 (2); 3/15/2005 (1) | no |
| 136 | `B_stq2date-2` | 1.1% | NULL (4036); 9/3/2003 (16); 7/5/2006 (8); 7/2/2008 (7); 10/21/2009 (5); 7/13/2005 (3); 7/11/2007 (3); 7/7/2010 (2); 7/7/2008 (1); 10/7/2008 (1) | no |
| 137 | `B_stq3date-2` | 1.1% | NULL (4039); 10/24/2003 (16); 10/3/2006 (8); 10/21/2009 (7); 10/7/2008 (6); 10/1/2007 (3); 10/5/2005 (2); 1/3/2011 (1) | no |
| 138 | `B_stq4date-2` | 1.2% | NULL (4035); 1/26/2004 (18); 1/12/2010 (9); 1/2/2007 (5); 1/14/2009 (4); 1/9/2008 (3); 1/2/2006 (3); 1/24/2004 (2); 10/3/2006 (1); 1/3/2011 (1); 1/13/2010 (1) | no |
| 139 | `B_stq1-3` | 0.9% | 37 distinct (too many to list) | no |
| 140 | `B_stq2-3` | 0.9% | 36 distinct (too many to list) | no |
| 141 | `B_stq3-3` | 0.6% | NULL (4057); 5521 (1); 5198 (1); 5197 (1); 5196 (1); 5195 (1); 5194 (1); 5192 (1); 5190 (1); 5189 (1); 4360 (1); 3939 (1); 3566 (1); 3565 (1); 2952 (1); 2951 (1); 2950 (1); 2949 (1); 2948 (1); 2947 (1); 2946 (1); 2945 (1); 2944 (1); 2943 (1); 2942 (1) | no |
| 142 | `B_stq4-3` | 0.7% | 28 distinct (too many to list) | no |
| 143 | `B_stq1date-3` | 0.9% | NULL (4045); 5/7/2004 (13); 4/7/2010 (8); 5/5/2004 (3); 4/8/2009 (3); 4/4/2007 (3); 4/1/2008 (3); 7/7/2004 (1); 4/29/2004 (1); 4/13/2011 (1); 11/21/2006 (1) | no |
| 144 | `B_stq2date-3` | 0.9% | NULL (4046); 7/7/2004 (16); 7/7/2010 (10); 7/11/2007 (3); 10/21/2009 (3); 7/5/2006 (2); 7/2/2008 (1); 7/19/2011 (1) | no |
| 145 | `B_stq3date-3` | 0.6% | NULL (4057); 10/4/2004 (12); 1/3/2011 (8); 10/3/2006 (2); 10/7/2008 (1); 10/12/2011 (1); 10/1/2007 (1) | no |
| 146 | `B_stq4date-3` | 0.7% | NULL (4054); 1/12/2005 (11); 1/3/2011 (8); 1/12/2010 (3); 1/2/2007 (2); 1/13/2010 (2); 1/14/2009 (1); 1/1/2008 (1) | no |
| 147 | `B_styear2` | 1.0% | NULL (4042); 1/1/2003 (26); 1/1/2006 (7); 1/1/2007 (4); 1/1/2005 (3) | no |
| 148 | `B_styear3` | 0.7% | NULL (4053); 1/1/2004 (22); 1/1/2007 (4); 1/1/2006 (2); 1/26/2004 (1) | no |
| 149 | `SCJ_billabe_time` | 3.9% | NULL (3900); 1.5 (49); 1.0 (33); 1.25 (29);  (21); 1 (13); 2.0 (11); 1.75 (8); 2 (7); 2.5 (3); .75 (3); 6.5 (1); 4 (1); 3.0 (1); 1.5 hrs (1); 1  (1) | no |
| 150 | `SCJ_Shipping` | 4.3% | 52 distinct (too many to list) | no |
| 151 | `SCJ_Xray` | 8.5% | 28 distinct (too many to list) | no |
| 152 | `SCJ_report` | 0.2% | NULL (4075); Yes (2); 9/15/03 (1); 8/25/02 (1); 7/30/03 (1); 5/25/03 (1); 3/9/03 (1) | no |
| 153 | `SCJ_photos` | 0.1% | NULL (4079); Yes (2); yes (1) | no |
| 154 | `SCJ_category` | 11.5% | 62 distinct (too many to list) | no |
| 155 | `SCJ_Contact_consumer_date` | 20.0% | 573 distinct (too many to list) | no |
| 156 | `SCJ_Envelope_sent_Date` | 0.2% | NULL (4074); 10/5/2004 (4); 6/30/2004 (2); 8/23/2002 (1); 7/2/2002 (1) | no |
| 157 | `SCJ_results` | 11.2% | 91 distinct (too many to list) | no |
| 158 | `CL_mobile_AC` | 1.5% | 51 distinct (too many to list) | no |
| 159 | `Cl_Mobile_#` | 1.5% | 55 distinct (too many to list) | no |
| 160 | `CL_mobile_EX` | 0.1% | NULL (4077); Mrs. (1); MRs. (1); Karen H (1); Gen Man Daniel Hill (1); Cory (1) | no |
| 161 | `CL_Special_Directions` | 0.0% | NULL (4082) | no |
| 162 | `I_Mobile_AC` | 2.0% | NULL (3999); 313 (15); 765 (10); 574 (10); 586 (7); 248 (7); 260 (5); 219 (4); 989 (3); 734 (3); 419 (3); 317 (3); 517 (2); 269 (2); 937 (1); 865 (1); 810 (1); 716 (1); 513 (1); 423 (1); 419- (1); 231 (1); 217 (1) | no |
| 163 | `I_Mobile_#` | 2.0% | 83 distinct (too many to list) | no |
| 164 | `I_Mobile_EX` | 0.1% | NULL (4077); Mrs. (1); MARK (1); M-i-l (1); Cyle (1); Chad husband (1) | no |
| 165 | `I_Directions` | 1.0% | 29 distinct (too many to list) | no |
| 166 | `P_Date_code` | 5.3% | 203 distinct (too many to list) | no |
| 167 | `P_Upc_code` | 0.0% | NULL (4080); W023C (1); ?060C (1) | no |
| 168 | `P_Where_purchase` | 0.7% | NULL (4055); Wal-Mart (4); WalMart (2); Target (2); Wal-Mart (Store 1366) 3500 East Main Street Merrill, WI  ... (1); Wal Mart (1); WALMART (1); Thrift Drugs (1); Target Store Milwaukee (1); Shop Rite (1); Sears purchased 1/10/2000 (1); Sears 5/12/99 (1); Sears  1/15/10 (1); Sams Club (1); Purchased Feb or Mar 04 (1); Piggly Wiggly (1); N/A (1); Lowes in 2001 (1); Lowes  August 2003 (1); Kroger (1); Kennedy /Hahn Appliance PO Box 427 Waunakee, WI  53597 (1); Chucks Appliance and Furniture, Inc. (1); Best Buy?????? (1) | no |
| 169 | `P_how_long_in_use` | 1.1% | 39 distinct (too many to list) | no |
| 170 | `D_exam_date2` | 3.7% | 151 distinct (too many to list) | no |
| 171 | `D_exam_date_3` | 0.8% | 34 distinct (too many to list) | no |
| 172 | `D_exam_date_4` | 0.2% | NULL (4073); 6/23/2005 (1); 5/11/2009 (1); 4/16/2007 (1); 3/3/2006 (1); 3/18/2009 (1); 3/16/2005 (1); 2/3/2009 (1); 11/3/2005 (1); 10/4/2004 (1) | no |
| 173 | `D_exam_date_5` | 0.1% | NULL (4079); 5/12/2009 (1); 2/4/2009 (1); 11/4/2005 (1) | no |
| 174 | `DX_ltnme` | 12.0% | 348 distinct (too many to list) | no |
| 175 | `DX_fnme` | 12.1% | 182 distinct (too many to list) | no |
| 176 | `DX_company` | 11.2% | 296 distinct (too many to list) | no |
| 177 | `DX_idendifier` | 1.7% | 38 distinct (too many to list) | no |
| 178 | `DX_address` | 5.9% | 208 distinct (too many to list) | no |
| 179 | `DX_City` | 6.9% | 191 distinct (too many to list) | no |
| 180 | `DX_State` | 7.3% | 38 distinct (too many to list) | no |
| 181 | `DX_zip` | 5.0% | 151 distinct (too many to list) | no |
| 182 | `DX_OfficeAC` | 8.5% | 139 distinct (too many to list) | no |
| 183 | `DX_pffice#` | 8.3% | 256 distinct (too many to list) | no |
| 184 | `DX_officeEX` | 0.3% | NULL (4065);  (5); 245 (2); akron (1); X 16 (1); Akron (1); 9170 (1); 6464 (1); 335 (1); 26 (1); 1865 (1); 1257 (1); 10 (1) | no |
| 185 | `DX_directAC` | 0.3% | NULL (4068); 540 (3); 865 (1); 800 (1); 770- (1); 740 (1); 618 (1); 603 (1); 404 (1); 330 (1); 317 (1); 215 (1); 201 (1) | no |
| 186 | `DX_direct#` | 0.3% | NULL (4071); 966-3591 (1); 943-6530 (1); 868-5516 (1); 850-6001 (1); 684-2614 (1); 625-9744 (1); 528-1500 (1); 487-8901 (1); 482-8480 (1); 216-7268 (1); 213-8434 (1) | no |
| 187 | `DX_DieectEX` | 0.0% | NULL (4080); Cleveland (1); 11 (1) | no |
| 188 | `Dx_faxAC` | 3.1% | 69 distinct (too many to list) | no |
| 189 | `DX_fax_#` | 3.1% | 92 distinct (too many to list) | no |
| 190 | `Dx_fax_EX` | 0.0% | NULL (4082) | no |
| 191 | `DX_mobileAC` | 1.6% | 41 distinct (too many to list) | no |
| 192 | `DX_mobile_#` | 1.4% | 56 distinct (too many to list) | no |
| 193 | `DX_mobileEX` | 0.0% | NULL (4082) | no |
| 194 | `DX_pagerAC` | 0.1% | NULL (4078); 207 (2); 419 (1);  (1) | no |
| 195 | `DX_pager#` | 0.1% | NULL (4078); 821-9121 (2); 509-7264 (1);  (1) | no |
| 196 | `DX_pager_EX` | 0.0% | NULL (4082) | no |
| 197 | `DX_homeAC` | 0.1% | NULL (4077); 315 (2); 978 (1); 801 (1); 781 (1) | no |
| 198 | `Dx_home_#` | 0.1% | NULL (4077); 637-1458 (2); 933-4301 (1); 922-2665 (1); 261-1499 (1) | no |
| 199 | `DX_home_EX` | 0.0% | NULL (4082) | no |
| 200 | `DX_tollfreeAC` | 0.8% | NULL (4048); 800 (28); 877 (3); 888 (1); 866 (1); 330 (1) | no |
| 201 | `DX_toll_free_#` | 0.9% | NULL (4047); 865-6220 (11); 848-9313 (2); 675-8500 (2); 347-3103 (2); 271-1168 (2); 893-4047 (1); 875-3099 (1); 865-8660 (1); 827-7823 (1); 782-6851 (1); 771-0591 (1); 759-0556 (1); 752-2373 (1); 693-2085 (1); 580-7047 (1); 528-1500 (1); 473-9050 (1); 436-0697 (1); 362-3473 (1); 354-5611 (1); 216-7268 (1) | no |
| 202 | `DX_TollfreeEX` | 0.0% | NULL (4080); cleveland (1); 210 (1) | no |
| 203 | `DX_depo` | 0.0% | NULL (4082) | no |
| 204 | `PX_lnme` | 5.9% | 190 distinct (too many to list) | no |
| 205 | `PX_fnme` | 2.2% | 68 distinct (too many to list) | no |
| 206 | `PX_company` | 1.7% | 64 distinct (too many to list) | no |
| 207 | `PX_Identifier` | 0.3% | NULL (4070); EFI (2); CC (2); UIS (1); SEL (1); SEA (1); RMHA (1); PES (1); NIC (1); ATSI (1); AE (1) | no |
| 208 | `PX_adress` | 0.8% | 32 distinct (too many to list) | no |
| 209 | `PX_city` | 1.0% | 37 distinct (too many to list) | no |
| 210 | `PX_state` | 0.9% | NULL (4044); TX (5); MI (5); IN (4); IL (4); FL (4); TN (2); NY (2); CA (2); AL (2); WI (1); WA (1); PA (1); OK (1); NH (1); MO (1); MN (1); KS (1) | no |
| 211 | `PX_zip` | 0.7% | 28 distinct (too many to list) | no |
| 212 | `PX_officeAC` | 0.9% | 31 distinct (too many to list) | no |
| 213 | `Px_office#` | 0.9% | 36 distinct (too many to list) | no |
| 214 | `PX_officeEX` | 0.0% | NULL (4081); 137 (1) | no |
| 215 | `PX_cirectAC` | 0.0% | NULL (4080); 508 (1); 507 (1) | no |
| 216 | `PX_direct_#` | 0.0% | NULL (4080); 997-4900 (1); 364-7373 (1) | no |
| 217 | `PX_directEX` | 0.0% | NULL (4082) | no |
| 218 | `PX_faxAC` | 0.5% | NULL (4060); 903 (2); 801 (2); 281 (2); 913 (1); 905 (1); 901 (1); 888 (1); 850 (1); 717 (1); 661 (1); 630 (1); 615 (1); 507 (1); 423 (1); 334 (1); 317- (1); 317 (1); 217 (1); 214 (1) | no |
| 219 | `PX_fax#` | 0.5% | NULL (4060); 912-6760 (2); 946-8586 (1); 932-2082 (1); 892-4265 (1); 884-3473 (1); 819-3473 (1); 778-0170 (1); 687-2307 (1); 637-1990 (1); 564-0781 (1); 561-8841 (1); 548-3562 (1); 513-9503 (1); 496-9604 (1); 377-8838 (1); 364-7374 (1); 355-7900 (1); 347-5150 (1); 341-9127 (1); 321-1847 (1); 253-2138 (1) | no |
| 220 | `PX_fax_EX` | 0.0% | NULL (4082) | no |
| 221 | `PX_mobileAc` | 0.1% | NULL (4078); 954 (1); 713 (1); 256 (1); 231 (1) | no |
| 222 | `PX_mobile#` | 0.1% | NULL (4078); 857-4846 (1); 642-9090 (1); 328-5987 (1); 313-1011 (1) | no |
| 223 | `PXmobileEX` | 0.0% | NULL (4082) | no |
| 224 | `PX_pager_AC` | 0.0% | NULL (4082) | no |
| 225 | `PX_pager_#` | 0.0% | NULL (4082) | no |
| 226 | `PX_pagerEX` | 0.0% | NULL (4082) | no |
| 227 | `PX_home_AC` | 0.0% | NULL (4082) | no |
| 228 | `PX_home_#` | 0.0% | NULL (4082) | no |
| 229 | `PX_homeEX` | 0.0% | NULL (4082) | no |
| 230 | `PX_tollfreeAC` | 0.1% | NULL (4076); 800 (5); 888 (1) | no |
| 231 | `PX_tolllfree#` | 0.1% | NULL (4076); 789-5611 (1); 680-4738 (1); 615-4840 (1); 582-3473 (1); 373-7753 (1); 216-7268 (1) | no |
| 232 | `PX_tollfree_EX` | 0.0% | NULL (4082) | no |
| 233 | `PX_depo` | 0.0% | NULL (4082) | no |
| 234 | `DX_notes` | 0.0% | NULL (4082) | no |
| 235 | `PX_notes` | 0.9% | 33 distinct (too many to list) | no |
| 236 | `Workorder_notes` | 66.4% | 2632 distinct (too many to list) | no |
| 237 | `D_Date_of_loss` | 70.1% | 2216 distinct (too many to list) | no |
| 238 | `C_PO_box` | 6.4% | 123 distinct (too many to list) | no |
| 239 | `I_Address_2` | 0.4% | NULL (4049);  (17); PO Box 241809 (5); m3hammer@aol.com (1); Waterford Apartments (1); Trailer 14 (1); Meridan Street (1); Crossland Lakes Apt. (1); Apt. 101 (1); Apt 3 (1); Apartment L (1); 812-867-7960 (1); 3771 East 10 Mile (1); 3525 Delaware (1) | no |
| 240 | `Workorder_evidence` | 42.3% | 847 distinct (too many to list) | no |
| 241 | `CL_Address_2` | 1.6% | 61 distinct (too many to list) | no |
| 242 | `SCJ_Submitted` | 1.8% | NULL (4007); 7/5/2002 (17); 9/16/02 (16); 5/25/03 (8); 8/25/02 (5); 9/23/02 (3); 7/15/03 (3); March 9, 2003 (2); 7/17/03 (2); 6/3/2002 (2); 5/28/2002 (2); 4/14/03 (2); June 30, 2003 (1); July 15, 2003 (1); 7/8/2002 (1); 7/30/03 (1); 7/14/03 (1); 7/05/03 (1); 4/27/2002 (1); 3/27/2002 (1); 3/10/03 (1); 3/09/03 (1); 10/14/02 (1); 10/07/02 (1); 1/14/2002 (1) | no |
| 243 | `BI_Bill_to` | 0.2% | NULL (4073); Other (8); Attorney (1) | no |
| 244 | `BI_Bltmnme` | 1.7% | NULL (4013); Croll (20); Moore (13); Charland (6); Roarty (5); Moore  (5); Sprenkle (4); Ehert (3); Drewett (2); Waring (1); Rectenwald (1); Powell (1); Morrison (1); MArtin (1); Livesay (1); Lacy (1); Keevan (1); Craig (1); Clouse (1); Bouyer (1) | no |
| 245 | `BI_Bfnme` | 1.7% | NULL (4013); Mike (18); James (13); Jim (7); Paul (6); Tim (5); Gary (4); Megan (3); Angel (2); Wendi (1); Valeda (1); Terry (1); Tammy (1); Raymond (1); Pat (1); Michael (1); Kathy (1); Kathleen (1); Joe (1); Brad (1) | no |
| 246 | `Bi_Bcompany` | 1.7% | NULL (4013); Crawford & Company (19); Thomson, Inc. (16); Fisher Price (6); Thomson Multimedia, Com (5); Specialty Risk Services (4); Mitsui Sumitomo Insurance Group (4); SRS (3); State Farm Insurance Company (2); Young Clements Rivers & Tisdale (1); William Beaumont Hospital (1); Mitsui Sumitomo Marine Management (1); Mitsui Sumitomo (1); Kentucky Farm Bureau Insurance (1); Ivestigative Resources Global, Inc. (1); Gallagher Bassett Services (1); Gallagher BAssett Services (1); Crawfrod & Company (1); American Bankers Insurance Company (1) | no |
| 247 | `BI_Bidentifier` | 0.4% | NULL (4067); CC (15) | no |
| 248 | `BI_B_Baddress` | 1.7% | NULL (4013); P.O. Box 5154 (19); P.O. Box 1976, INH 340 (15); 636 Girard Avenue (6); Po Box 1976 INH  340 (5); P.O. Box 219034 (5); 312 Elm Street, 11th Floor (3); P.O> Box 219034 (2); 8 Flowers Drive (2); 312 Elm Street, 11th floor (2); PO Box 21487 (1); PO Box 20700 (1); P.O. Box 5154  (1); INH  340  P.O. Box 1976 (1); 7621 Litle Avenue Suite 426 (1); 4703 Centerline Drive (1); 3601 W. 13 Mile Rd. (1); 28 Broad St  PO Box 993 (1); 2550 Northwestern Avenue (1); 1300 East Lookout Drive, Suite 140 (1) | no |
| 249 | `BI_Bpobox` | 0.0% | NULL (4082) | no |
| 250 | `BI_Bcity` | 1.7% | NULL (4013); Indianapolis (21); Southfield (20); Dallas (7); East Aurora,  (6); Cincinnati (5); Mechanicsburg (2); West Lafayette (1); Royal Oak (1); Roanoke (1); Richardson (1); Louisville (1); Knoxville (1); Charlotte (1); Charleston (1) | no |
| 251 | `BI_Bstate` | 1.7% | NULL (4013); MI (21); in (15); TX (8); IN (7); NY (6); OH (5); PA (2); VA (1); TN (1); SC (1); NC (1); KY (1) | no |
| 252 | `BI_Bzip` | 1.7% | NULL (4013); 48086-5154 (18); 46206-1976 (16); 75221 (7); 14052 (6); 46206 (5); 45202- (5); 17050 (2); 76 (1); 75082 (1); 58086-5154 (1); 48073 (1); 46906-1394 (1); 40250 (1); 37917 (1); 29402-0993 (1); 28226 (1); 24018 (1) | no |
| 253 | `BI_BofficeAC` | 0.3% | NULL (4071); 866 (5); 800- (2); 717 (2); 972- (1); 843 (1) | no |
| 254 | `BI_Boffice#` | 0.3% | NULL (4071); 676-6272 (5); 677-1412 (2); 697-1266 (1); 577-4000 (1); 454-1709 (1); 246-2631 (1) | no |
| 255 | `BI_BofficeEX` | 0.0% | NULL (4081); 257 (1) | no |
| 256 | `BI_MIC11` | 0.9% | NULL (4047); Postage (11); Shipping (7); X-ray (5); Photographs (2); Travel Time (1); Telephone (1); Report (1); Prep Time (1); Outside Service (1); Mileage (1); Laboratory Te (1); Hotel (1); Examination (1); Conference (1) | no |
| 257 | `BI_MIC12` | 0.3% | NULL (4071); Shipping (5); Postage (3); Mileage (2); Rental Car (1) | no |
| 258 | `BI_MIc_13` | 0.2% | NULL (4074); Shipping (3); Postage (2); Per diem (1); Outside Service (1); Mileage (1) | no |
| 259 | `BI_MIc_14` | 0.1% | NULL (4077); Shipping (1); Postage (1); Per diem (1); Mileage (1); Laboratory Te (1) | no |
| 260 | `BI_MIc_15` | 0.1% | NULL (4076); Travel Time (1); Shipping (1); Report (1); Meeting (1); Laboratory Te (1); Examination (1) | no |
| 261 | `BI_MIc_16` | 0.1% | NULL (4078); Mileage (2); Travel Time (1); Travel Air (1) | no |
| 262 | `BI_MIc_17` | 0.0% | NULL (4080); Hotel (1); Examination (1) | no |
| 263 | `BI_MIc_18` | 0.0% | NULL (4080); Travel Time (1); Prep Time (1) | no |
| 264 | `BI_MIc_19` | 0.0% | NULL (4081); Photographs (1) | no |
| 265 | `BI_MIc_10` | 2.7% | NULL (3971); Postage (41); X-ray (16); Shipping (10); Examination (9); Photographs (8); Telephone (6); Review Data (4); Outside Service (4); Travel Time (2); Report (2); Miscellaneous (2); Hotel (2); Conference (2); Photo Log (1); Deposition (1); Adminstrative Support (1) | no |
| 266 | `BI_MID10` | 2.4% | 74 distinct (too many to list) | no |
| 267 | `BI_MID11` | 0.8% | 29 distinct (too many to list) | no |
| 268 | `BI_MID12` | 0.2% | NULL (4073); 3/3/2004 (2); 4/2/2003 (1); 3/8/2004 (1); 3/26/2003 (1); 3/24/2004 (1); 3/15/2004 (1); 2/25/2003 (1); 2/23/2004 (1) | no |
| 269 | `BI_MID13` | 0.2% | NULL (4074); 3/3/2004 (2); 5/12/2003 (1); 4/8/2003 (1); 3/28/2003 (1); 3/24/2004 (1); 2/25/2003 (1); 10/3/2003 (1) | no |
| 270 | `BI_MID14` | 0.1% | NULL (4077); 3/3/2004 (1); 3/28/2003 (1); 2/25/2003 (1); 11/10/2003 (1); 10/8/2003 (1) | no |
| 271 | `BI_MID15` | 0.1% | NULL (4076); 3/3/2004 (1); 2/24/2003 (1); 2/21/2003 (1); 2/19/2003 (1); 10/28/2002 (1); 10/15/2003 (1) | no |
| 272 | `BI_MID16` | 0.1% | NULL (4078); 5/5/2003 (1); 2/24/2003 (1); 2/21/2003 (1); 2/19/2003 (1) | no |
| 273 | `BI_MID17` | 0.0% | NULL (4080); 2/25/2003 (1); 2/19/2002 (1) | no |
| 274 | `BI_MID18` | 0.0% | NULL (4080); 2/5/2003 (1); 2/25/2003 (1) | no |
| 275 | `BI_MID19` | 0.0% | NULL (4081); 2/25/2003 (1) | no |
| 276 | `BI_MIS10` | 2.7% | 91 distinct (too many to list) | no |
| 277 | `BI_MIS11` | 0.8% | 31 distinct (too many to list) | no |
| 278 | `BI_MIS12` | 0.3% | NULL (4071); 9.37 (1); 8.57 (1); 72.41 (1); 42 (1); 400 (1); 30.49 (1); 17.01 (1); 16.99 (1); 16.46 (1); 13.15 (1); 10.97 (1) | no |
| 279 | `BI_MIS13` | 0.2% | NULL (4074); 6.20 fuel (1); 537.86 (1); 29.38 (1); 25 (1); 22.95 (1); 15.01 (1); 13.53 (1); 10.44 (1) | no |
| 280 | `BI_MIS14` | 0.1% | NULL (4077); 25.00 (1); 20.43 (1); 1674.20 (1); 15.78 (1); 123 (1) | no |
| 281 | `BI_MIS15` | 0.1% | NULL (4076); 9.378 (1); 5.5 (1); 4 (1); 3 (1); 100.00 (1); 1 (1) | no |
| 282 | `BI_MIS16` | 0.1% | NULL (4078); 820 (1); 47 (1); 4 (1); 300 (1) | no |
| 283 | `BI_MIS17` | 0.0% | NULL (4080); 9 (1); 231.68 (1) | no |
| 284 | `BI_MIS18` | 0.0% | NULL (4080); 8 (1); 6 (1) | no |
| 285 | `BI_MIS19` | 0.0% | NULL (4081); 895 (1) | no |
| 286 | `BI_TRP1date` | 1.7% | 66 distinct (too many to list) | no |
| 287 | `BI_TRP2date` | 0.2% | NULL (4073); 6/26/03 (3); 8/14/02 (1); 6/17/03 (1); 4/30/02 (1); 3/05/02 (1); 2/04/04 (1); 02/3/03 (1) | no |
| 288 | `BI_TRP3date` | 0.0% | NULL (4081); 10/09/02 (1) | no |
| 289 | `BI_TRPC10` | 1.5% | NULL (4020); Travel Time (28); Hotel (10); Travel Air (8); Photographs (4); Rental Car (3); Examination (2); Travel time (1); Telephone (1); Review Data (1); Research (1); Report (1); On-site (1); Letter (1) | no |
| 290 | `BI_TRPC11` | 1.2% | NULL (4031); Examination (16); Travel Time (10); Travel Air (9); On-site (5); Meeting (3); Meals (2); Shipping (1); Rental Car (1); Outside Service (1); Mileage (1); Hotel (1); Conference (1) | no |
| 291 | `BI_TRPC12` | 1.1% | NULL (4037); Travel Time (17); Examination (8); On-site (7); Hotel (4); Photographs (2); Parking (2); Mileage (2); Report (1); Rental Car (1); Deposition (1) | no |
| 292 | `BI_TRPC13` | 0.9% | NULL (4045); Travel Time (10); Mileage (6); Photographs (4); Travel Air (3); Examination (3); Rental Car (2); On-site (2); Hotel (2); Report (1); Parking (1); Meals (1); Deposition (1); Adminstrative Support (1) | no |
| 293 | `BI_TRPC14` | 0.7% | NULL (4052); Travel Time (8); Rental Car (4); Mileage (4); Travel Air (3); Photographs (3); Hotel (3); On-site (2); Prep Time (1); Meeting (1); Examination (1) | no |
| 294 | `BI_TRPC15` | 0.5% | NULL (4062); Travel Time (3); On-site (3); Hotel (3); Travel Air (2); Rental Car (2); Meals (2); Report (1); Prep Time (1); Photographs (1); Mileage (1); Examination (1) | no |
| 295 | `BI_TRPC16` | 0.4% | NULL (4065); Travel Time (4); Photographs (4); Rental Car (2); Parking (2); Travel Air (1); Read Depo (1); Meals (1); Hotel (1); Conference (1) | no |
| 296 | `BI_TRPC17` | 0.2% | NULL (4073); Parking (4); Review Data (1); Rental Car (1); Photographs (1); Mileage (1); Conference (1) | no |
| 297 | `BI_TRPC18` | 0.1% | NULL (4077); Photographs (1); Per diem (1); On-site (1); Meals (1); Examination (1) | no |
| 298 | `BI_TRPC19` | 0.1% | NULL (4079); Travel Air (1); Parking (1); Meals (1) | no |
| 299 | `BI_TRPS10` | 1.3% | 42 distinct (too many to list) | no |
| 300 | `BI_TRPS11` | 1.1% | 35 distinct (too many to list) | no |
| 301 | `BI_TRPS12` | 0.9% | 30 distinct (too many to list) | no |
| 302 | `BI_TRPS13` | 0.8% | 26 distinct (too many to list) | no |
| 303 | `BI_TRPS14` | 0.6% | NULL (4056); 6 (4); 98 x 2sets (1); 960.00 (1); 86.80 (1); 7 (1); 58.94 (1); 56.58 (1); 56.41 (1); 420 (1); 4 (1); 370 (1); 342 (1); 340 (1); 304.43 (1); 300 (1); 3.5 (1); 3 3/26/03 (1); 3 (1); 200.80 (1); 2.5 (1); 16 (1); 14.5  6/2 (1); 1080.00 (1) | no |
| 304 | `BI_TRPS15` | 0.4% | NULL (4065); 4 (3); 820 (1); 8 (1); 767.19 (1); 7 (1); 6 (1); 50 (1); 5 (1); 400 (1); 4  3/28/03 (1); 288.85 (1); 212.28 (1); 184.36 (1); 1600.00@ (1); 11.56 (1) | no |
| 305 | `BI_TRPS16` | 0.3% | NULL (4070); 8 (1); 745.34 (1); 68.75 (1); 67.18 (1); 60.00 (1); 6.5 (1); 6 (1); 5 (1); 4sets of142 (1); 30.00 (1); 1 6/3/03 (1); 1 4/7/03 (1) | no |
| 306 | `BI_TRPS17` | 0.2% | NULL (4074); 30.00 (1); 30 (1); 190.10 (1); 15 (1); 148 X 2sets (1); 10 (1); 1 4/21/03 (1); .75 (1) | no |
| 307 | `BI_TRPS18` | 0.1% | NULL (4076); 4.25 fuel (1); 2 3/28/03 (1); 150 (1); 148 x4sets  (1); 11.5 6/3 (1);   (1) | no |
| 308 | `BI_TRPS19` | 0.1% | NULL (4079); 7.18 (1); 6.75 (1); 30 (1) | no |
| 309 | `BI_TRPC20` | 0.2% | NULL (4073); Travel Time (5); Hotel (2); Research (1); Examination (1) | no |
| 310 | `BI_TRPC21` | 0.2% | NULL (4075); X-ray (2); Examination (2); Travel Time (1); Travel Air (1); Mileage (1) | no |
| 311 | `BI_TRPC22` | 0.1% | NULL (4077); Travel Time (1); Research (1); On-site (1); Mileage (1); Examination (1) | no |
| 312 | `BI_TRPC23` | 0.1% | NULL (4077); Travel Time (1); Protocol (1); Mileage (1); Hotel (1); Examination (1) | no |
| 313 | `BI_TRPC24` | 0.1% | NULL (4077); Photographs (2); Travel Time (1); Research (1); Miscellaneous (1) | no |
| 314 | `BI_TRPC25` | 0.0% | NULL (4080); Research (1); Rental Car (1) | no |
| 315 | `BI_TRPC26` | 0.0% | NULL (4080); Travel Air (1); Report (1) | no |
| 316 | `BI_TRPC27` | 0.0% | NULL (4081); Parking (1) | no |
| 317 | `BI_TRPC28` | 0.0% | NULL (4082) | no |
| 318 | `BI_TRPC29` | 0.0% | NULL (4082) | no |
| 319 | `BI_TRPS20` | 0.2% | NULL (4073); 3.0 (2); 800.12 (1); 577.15 (1); 5 hrs (1); 4.5 6/4 (1); 3 (1); 1.5 (1); .5 4/30/03 (1) | no |
| 320 | `BI_TRPS21` | 0.2% | NULL (4075); 8 (1); 79.00 (1); 5 (1); 494.40 (1); 263 (1); 2 hrs (1); 2 5/5/03 (1) | no |
| 321 | `BI_TRPS22` | 0.1% | NULL (4077); 8 (1); 326 (1); 3 6/4 (1); 3 (1); 1 6/6/03 (1) | no |
| 322 | `BI_TRPS23` | 0.1% | NULL (4077); 8 (1); 350 (1); 219.78 (1); 1.54/22/03 (1); 1.0 6/30/03 (1) | no |
| 323 | `BI_TRPS24` | 0.1% | NULL (4077); 290 (1); 2 6/9/03 (1); 18 rolls (1); 16.00 fuel (1); 13 (1) | no |
| 324 | `BI_TRPS25` | 0.0% | NULL (4080); 298.13 (1); 2  6/11/03 (1) | no |
| 325 | `BI_TRPS26` | 0.0% | NULL (4080); 1180.00 (1); 1.5 (1) | no |
| 326 | `BI_TRPS27` | 0.0% | NULL (4081); 50.00 (1) | no |
| 327 | `BI_TRPS28` | 0.0% | NULL (4082) | no |
| 328 | `BI_TRPS29` | 0.0% | NULL (4082) | no |
| 329 | `BI_TRPC30` | 0.0% | NULL (4082) | no |
| 330 | `BI_TRPC31` | 0.0% | NULL (4082) | no |
| 331 | `BI_TRPC32` | 0.0% | NULL (4082) | no |
| 332 | `BI_TRPC33` | 0.0% | NULL (4082) | no |
| 333 | `BI_TRPC34` | 0.0% | NULL (4082) | no |
| 334 | `BI_TRPC35` | 0.0% | NULL (4082) | no |
| 335 | `BI_TRPC36` | 0.0% | NULL (4082) | no |
| 336 | `BI_TRPC37` | 0.0% | NULL (4082) | no |
| 337 | `BI_TRPC38` | 0.0% | NULL (4082) | no |
| 338 | `BI_TRPC39` | 0.0% | NULL (4082) | no |
| 339 | `BI_TRPS30` | 0.0% | NULL (4082) | no |
| 340 | `BI_TRPS31` | 0.0% | NULL (4082) | no |
| 341 | `BI_TRPS32` | 0.0% | NULL (4082) | no |
| 342 | `BI_TRPS33` | 0.0% | NULL (4082) | no |
| 343 | `BI_TRPS34` | 0.0% | NULL (4082) | no |
| 344 | `BI_TRPS35` | 0.0% | NULL (4082) | no |
| 345 | `BI_TRPS36` | 0.0% | NULL (4082) | no |
| 346 | `BI_TRPS37` | 0.0% | NULL (4082) | no |
| 347 | `BI_TRPS38` | 0.0% | NULL (4082) | no |
| 348 | `BI_TRPS39` | 0.0% | NULL (4082) | no |
| 349 | `BI_inv#1` | 44.2% | 1768 distinct (too many to list) | no |
| 350 | `BI_inv#2` | 10.8% | 439 distinct (too many to list) | no |
| 351 | `BI_inv#3` | 3.4% | 139 distinct (too many to list) | no |
| 352 | `BI_inv#4` | 1.0% | 42 distinct (too many to list) | no |
| 353 | `BI_inv#5` | 0.4% | NULL (4067); 5479 (1); 5458 (1); 5380 (1); 5225 (1); 5179 (1); 5166 (1); 4816 (1); 4746 (1); 4274 (1); 4261 (1); 4062 (1); 3824 (1); 3814 (1); 3658 (1); 2994 (1) | no |
| 354 | `BI_invdate1` | 44.3% | 713 distinct (too many to list) | no |
| 355 | `BI_invdate2` | 10.8% | 293 distinct (too many to list) | no |
| 356 | `BI_invdate3` | 3.4% | 122 distinct (too many to list) | no |
| 357 | `BI_invdate4` | 1.0% | 40 distinct (too many to list) | no |
| 358 | `BI_invdate5` | 0.4% | NULL (4067); 9/23/2009 (1); 8/31/2011 (1); 8/16/2011 (1); 7/29/2008 (1); 7/16/2008 (1); 6/6/2007 (1); 6/20/2007 (1); 6/1/2011 (1); 12/4/2009 (1); 12/27/2006 (1); 12/13/2010 (1); 11/23/2004 (1); 11/16/2010 (1); 1/22/2008 (1); 1/11/2011 (1) | no |
| 359 | `PX1_lnme_Copy` | 1.7% | 50 distinct (too many to list) | no |
| 360 | `PX1_fnme_Copy` | 1.6% | 41 distinct (too many to list) | no |
| 361 | `PX1_company_Copy` | 1.0% | 36 distinct (too many to list) | no |
| 362 | `PX1_Identifier_Copy` | 0.1% | NULL (4079); SFI (1); MIS (1); EFI (1) | no |
| 363 | `PX1_adress_Copy` | 0.4% | NULL (4063); 2902 N.W. Loop 410 (2); 1831 Howard Street (2); P.O. Box 6122 (1); 9707 Frankstown RD (1); 8150 W. 111th Street (1); 7349 Worthington-Galena Road (1); 6836 Hawthorn Park Dr (1); 616 Main Street, P.O. Box 43 (1); 535 Broad Hollow Road, Sutie B88 (1); 36135 Schoolcraft  (1); 333-A US Route 4 (1); 2141 West Grammercy Drive (1); 18322 State Road 101 (1); 1756 Harbor Way (1); 1210 Lancaster Dr. (1); 11151 Sun Center Drive, Suite A (1);   (1) | no |
| 364 | `PX1_city_Copy` | 0.6% | NULL (4058); Spencerville (3); San Antonio (2); Indianapolis (2); Elk Grove Village (2); lLivonia (1); Traverse City (1); Syracuse (1); St. Joseph (1); Spencerville,  (1); Seal Beach (1); Rancho Cordova (1); Penn Hills (1); Palos Hills (1); Melville (1); Houston (1); Green Valley (1); Columbus (1); Champaign (1); Barrington (1) | no |
| 365 | `PX1_state_Copy` | 0.5% | NULL (4060); IN (5); IL (4); TX (3); NY (2); MI (2); CA (2); PA (1); OH (1); NH (1); AZ (1) | no |
| 366 | `PX1_zip_Copy` | 0.4% | NULL (4064); 78230 (2); 60007 (2); 90740 (1); 85614 (1); 80134 (1); 64065 (1); 61821 (1); 49085-0043 (1); 48150 (1); 46788 (1); 46220-3909 (1); 43085 (1); 15235-1544 (1); 13217 (1); 11747 (1); 03825 (1) | no |
| 367 | `PX1_officeAC_Copy` | 0.7% | NULL (4055); 800 (5); 260 (3); 847 (2); 210 (2); 830 (1); 708 (1); 636 (1); 631 (1); 614 (1); 602 (1); 501 (1); 412 (1); 330 (1); 315 (1); 281 (1); 262 (1); 248 (1); 231 (1); 206 (1) | no |
| 368 | `Px1_office#_Copy` | 0.7% | NULL (4055); 238-5800 (4); 354-4720 (2); 344-2781 (2); 974-0092 (1); 961-2909 (1); 957-2152 (1); 946-5946 (1); 939-3854 (1); 927-0456 (1); 888-4160 (1); 721-5340 (1); 686-8837 (1); 675-8500 (1); 504-2000 (1); 446-9981 (1); 356-2991 (1); 355-7800 (1); 353-8224 (1); 342-3900 (1); 278-6058 (1); 249-7613 (1); 242-2725 (1) | no |
| 369 | `PX1_officeEX_Copy` | 0.0% | NULL (4082) | no |
| 370 | `PX1_cirectAC_Copy` | 0.0% | NULL (4082) | no |
| 371 | `PX1_direct_#_Copy` | 0.0% | NULL (4082) | no |
| 372 | `PX1_directEX_Copy` | 0.0% | NULL (4082) | no |
| 373 | `PX1_faxAC_Copy` | 0.2% | NULL (4073); 830 (1); 734 (1); 631 (1); 614 (1); 412 (1); 315 (1); 260 (1); 217 (1); 210 (1) | no |
| 374 | `PX1_fax#_Copy` | 0.2% | NULL (4073); 885-8014 (1); 591-0140 (1); 446-3547 (1); 424-2125 (1); 355-7900 (1); 344-1705 (1); 278-8812 (1); 249-7614 (1); 238-5829 (1) | no |
| 375 | `PX1_fax_EX_Copy` | 0.0% | NULL (4082) | no |
| 376 | `PX1_mobileAc__Copy` | 0.0% | NULL (4081); 830 (1) | no |
| 377 | `PX1_mobile#_Copy` | 0.0% | NULL (4081); 591-9997 (1) | no |
| 378 | `PX1_mobileEX_Copy` | 0.0% | NULL (4082) | no |
| 379 | `PX1_pager_AC_Copy` | 0.0% | NULL (4082) | no |
| 380 | `PX1_pager_#_Copy` | 0.0% | NULL (4082) | no |
| 381 | `PX1_pagerEX_Copy` | 0.0% | NULL (4082) | no |
| 382 | `PX1_home_AC_Copy` | 0.0% | NULL (4082) | no |
| 383 | `PX1_home_#_Copy` | 0.0% | NULL (4082) | no |
| 384 | `PX1_homeEX_Copy` | 0.0% | NULL (4082) | no |
| 385 | `PX1_tollfreeAC_Copy` | 0.0% | NULL (4081); 800 (1) | no |
| 386 | `PX1_tolllfree#_Copy` | 0.0% | NULL (4081); 782-6851 (1) | no |
| 387 | `PX1_tollfree_EX_Copy` | 0.0% | NULL (4082) | no |
| 388 | `PX1_depo_Copy` | 0.0% | NULL (4082) | no |
| 389 | `DX_expert` | 26.9% | NULL (2982); Plaintiff (1039); Defense (35); Expert (21); Plantiff (5) | no |
| 390 | `DX1_expert` | 1.9% | NULL (4003); Plaintiff (37); Defense (26); Expert (16) | no |
| 391 | `PX1_expert` | 8.1% | NULL (3753); Plaintiff (165); Defense (137); Expert (27) | no |
| 392 | `PX_expert` | 9.2% | NULL (3708); Plaintiff (264); Defense (80); Expert (29); Plantiff (1) | no |
| 393 | `PX1_notes_Copy` | 0.9% | NULL (4044); O & C (12); Electrical (4); EE (4); Electrical Eng (2); Whirlpool expert (1); STORAGE FACILITY One Pickering Road Rochester, NH (1); O & C File # 03-1860SF (1); Hunter Fan - EE (1); Hamilton Technology (1); Fujitsu Co-defendant (1); Fire Investigator (1); File #  A04-002-4580 (1); File #  2104 FF 2003 (1); FLA # A08-003-4757 (1); Electrical engineer and has the evidence. (1); CFI Mazzoneinvestigation@prodigy.net (1); C & O (1); ASKINSPECTORRICK@aol.com (1); AMFAM INSURANCE FIle # 651-328552 (1); 2193 FF 2003 (1) | no |
| 394 | `DX_ltnme_Copy` | 0.3% | NULL (4070); Williamson (1); Sanderson (1); Powell (1); Pooler (1); Pagels (1); Mahre (1); Long (1); Kacprowicz (1); Henry (1); Guilbert (1); Cope (1); Connor (1) | no |
| 395 | `DX_fnme_Copy` | 0.3% | NULL (4070); Ted (1); Robert E. (1); Robert (1); Ray (1); Ralph (1); Paul  (Chief) (1); Jack (1); David (1); Darryl (1); Cam (1); Bill (1); Alec (1) | no |
| 396 | `DX_company_Copy` | 0.2% | NULL (4075); State Farm Ins. (1); Ray Powell Investigations (1); Propane Technical Services (1); Pleasant Prairie Fire Department (1); Phillips Consumer Electronics Company (1); FirePROS (1); Consolidated Marine Services (1) | no |
| 397 | `DX_idendifier_Copy` | 0.0% | NULL (4081); SFI (1) | no |
| 398 | `DX_address_Copy` | 0.1% | NULL (4076); PO Box 3777 (1); One Phillips Drive, P.O. Box 14810 (1); 8505 West 183rd Street (1); 8410 Allerton LAne (1); 8044 88th Avenue (1); 1052 Merced Street (1) | no |
| 399 | `DX_City_Copy` | 0.1% | NULL (4076); Tinley Park (1); Pleasant Prairie (1); Knoxville (1); Jacksonville (1); Erie (1); Berkeley (1) | no |
| 400 | `DX_State_Copy` | 0.1% | NULL (4076); WI (1); TN (1); PA (1); IL (1); FL (1); CA (1) | no |
| 401 | `DX_zip_Copy` | 0.1% | NULL (4076); 94707 (1); 60477 (1); 53158-2015 (1); 37914 (1); 32256 (1); 16508 (1) | no |
| 402 | `DX_OfficeAC_Copy` | 0.1% | NULL (4077); 904 (1); 865 (1); 814 (1); 708 (1); 262 (1) | no |
| 403 | `DX_pffice#_Copy` | 0.1% | NULL (4077); 864-5311 (1); 781-2453 (1); 694-8027 (1); 641-2907 (1); 521-4701 (1) | no |
| 404 | `DX_officeEX_Copy` | 0.0% | NULL (4082) | no |
| 405 | `DX_directAC_Copy` | 0.0% | NULL (4082) | no |
| 406 | `DX_direct#__Copy` | 0.0% | NULL (4082) | no |
| 407 | `DX_DieectEX_Copy` | 0.0% | NULL (4082) | no |
| 408 | `Dx_faxAC_Copy` | 0.1% | NULL (4078); 865 (1); 814 (1); 708 (1); 262- (1) | no |
| 409 | `DX_fax_#_Copy` | 0.1% | NULL (4078); 864-5411 (1); 781-2481 (1); 697-1901 (1); 521-3402 (1) | no |
| 410 | `Dx_fax_EX_Copy` | 0.0% | NULL (4082) | no |
| 411 | `DX_mobileAC_Copy` | 0.0% | NULL (4082) | no |
| 412 | `DX_mobile_#_Copy` | 0.0% | NULL (4082) | no |
| 413 | `DX_mobileEX_Copy` | 0.0% | NULL (4082) | no |
| 414 | `DX_pagerAC_Copy` | 0.0% | NULL (4082) | no |
| 415 | `DX_pager#_Copy` | 0.0% | NULL (4082) | no |
| 416 | `DX_pager_EX_Copy` | 0.0% | NULL (4082) | no |
| 417 | `DX_homeAC_Copy` | 0.0% | NULL (4081); 865 (1) | no |
| 418 | `Dx_home_#_Copy` | 0.0% | NULL (4081); 690-8781 (1) | no |
| 419 | `DX_home_EX_Copy` | 0.0% | NULL (4082) | no |
| 420 | `DX_tollfreeAC_Copy` | 0.0% | NULL (4082) | no |
| 421 | `DX_toll_free_#_Copy` | 0.0% | NULL (4082) | no |
| 422 | `DX_TollfreeEX_Copy` | 0.0% | NULL (4082) | no |
| 423 | `DX_depo_Copy` | 0.0% | NULL (4082) | no |
| 424 | `DX_notes_Copy` | 0.9% | NULL (4046); CFEI (32); Ray Briss w/ SEMC Direct (1); Douglas McElinury (Asst Chief) (1); Department Manager Product Safety & Compliance (1); Cause and Origin 1824 FF 2001 (1) | no |
| 425 | `DA_lstnme_Copy` | 1.2% | 46 distinct (too many to list) | no |
| 426 | `DA_Frtnme_Copy` | 1.2% | 39 distinct (too many to list) | no |
| 427 | `DA_Firm_Copy` | 0.9% | 34 distinct (too many to list) | no |
| 428 | `DA_Adress_Copy` | 0.8% | 32 distinct (too many to list) | no |
| 429 | `DA_City_Copy` | 0.8% | 29 distinct (too many to list) | no |
| 430 | `DA_State_Copy` | 0.8% | NULL (4048); MI (6); TX (3); PA (3); NY (3); NJ (2); IL (2); FL (2); WA (1); RI (1); OH (1); NM (1); MO (1); MA (1); LA (1); KY (1); KS (1); IN (1); CT (1); CA (1); AZ (1) | no |
| 431 | `DA_Zip_Copy` | 0.8% | 31 distinct (too many to list) | no |
| 432 | `DAofficeAC_Copy` | 0.7% | NULL (4055); 215 (3); 313 (2); 973 (1); 913 (1); 860 (1); 816 (1); 716 (1); 713 (1); 617 (1); 616 (1); 561 (1); 517 (1); 516 (1); 505- (1); 480 (1); 415 (1); 401 (1); 317 (1); 314 (1); 281 (1); 248 (1); 216 (1); 206 (1); 201 (1) | no |
| 433 | `Da_office#_Copy` | 0.7% | 27 distinct (too many to list) | no |
| 434 | `DA_officeEX_Copy` | 0.0% | NULL (4081); 373 (1) | no |
| 435 | `DA_faxAC_Copy` | 0.4% | NULL (4064); 215 (3); 973 (1); 860 (1); 716- (1); 713 (1); 616 (1); 561- (1); 517 (1); 505 (1); 502 (1); 415 (1); 317 (1); 314 (1); 313 (1); 215- (1); 2016-781-0714 (1) | no |
| 436 | `DA_fax_#_Copy` | 0.4% | NULL (4065); 988-2757 (1); 963-2265 (1); 863-1723 (1); 8203347 (1); 768-3141 (1); 665-2013 (1); 588.2020 (1); 575-0856 (1); 566-5401 (1); 564-7699 (1); 541-9366 (1); 293-1979 (1); 292-1767 (1); 259-0450 (1); 257-8555 (1); 237-3900 (1); 229-1522 (1) | no |
| 437 | `DA_fax_EX_Copy` | 0.0% | NULL (4082) | no |
| 438 | `DA_mobileAC_Copy` | 0.1% | NULL (4079); 617 (1); 502 (1); 215- (1) | no |
| 439 | `DA_mobile_#_Copy` | 0.1% | NULL (4079); 905.4811  (1); 510-5849 (1); 327-4641 (1) | no |
| 440 | `DA_mobile_EX_Copy` | 0.0% | NULL (4082) | no |
| 441 | `DA_HomeAC_Copy` | 0.0% | NULL (4082) | no |
| 442 | `DA_home#_Copy` | 0.0% | NULL (4082) | no |
| 443 | `DA_homeEX_Copy` | 0.0% | NULL (4082) | no |
| 444 | `DA_pagerAC_Copy` | 0.0% | NULL (4082) | no |
| 445 | `DA_pager_#_Copy` | 0.0% | NULL (4082) | no |
| 446 | `DA_Pager_EX_Copy` | 0.0% | NULL (4082) | no |
| 447 | `DA_Direct_AC_Copy` | 0.2% | NULL (4075); 716 (1); 713 (1); 617 (1); 502. (1); 415 (1); 313 (1); 215 (1) | no |
| 448 | `DA_Direct_#_Copy` | 0.2% | NULL (4075); 995-5027 (1); 665-2144 (1); 588.2005 (1); 566-5475 (1); 446-5514 (1); 229-1947 (1); 228-4444 (1) | no |
| 449 | `Da_Direct_EX_Copy` | 0.0% | NULL (4082) | no |
| 450 | `DA_tollfree_AC_Copy` | 0.0% | NULL (4080); 866 (1); 800 (1) | no |
| 451 | `DA_tollfree#_Copy` | 0.0% | NULL (4080); 523-2900 (1); 231-0144 (1) | no |
| 452 | `DA_tollfree_EX_Copy` | 0.0% | NULL (4082) | no |
| 453 | `DA_Identifier_Copy` | 0.0% | NULL (4082) | no |
| 454 | `Da_notes_Copy` | 0.4% | NULL (4064); Electrical Engineer (2); sdickens@tmhd.com  (1); other attorneys Lloyd Milliken Carl Butler lmilliken@fbtl... (1); for Hanover insurance (1); chris.duggan@smithduggan.com (1); Landowner's attorney (1); Has unit (1); Hamilton Tech Corp (1); For Goff's (1); File No. 18.920 (1); File # 4100-4 (1); File # 099994.000 (1); FIle 8410.0003 (1); Attorney for Homeowners association (1); Attorney for Gehrig (1); Assistant Victoria Green File #  4272-7 (1);  Proctor Silex's Attorney (1) | no |
| 455 | `DA_Attorney` | 27.7% | NULL (2952); Plaintiff (888); Defense (223); Attorney (17); Plantiff (2) | no |
| 456 | `DA_Attorney_Copy` | 7.1% | NULL (3793); Plaintiff (174); Defense (112); Attorney (3) | no |
| 457 | `I_Company` | 0.0% | NULL (4082) | no |
| 458 | `I_identifier` | 0.0% | NULL (4082) | no |
| 459 | `CL_company` | 0.0% | NULL (4080); Union Nationla BAnk of Arkansas  (1); JC (1) | no |
| 460 | `CL_identifier` | 0.0% | NULL (4080); I (1); BPPW (1) | no |
| 461 | `D_Closed` | 47.0% | 734 distinct (too many to list) | no |
| 462 | `Drawings` | 0.5% | NULL (4061); Yes  (14); No (5); Yes (1); In File (1) | no |
| 463 | `Digital_pics` | 6.1% | NULL (3834); Yes  (122); Not Requested (49); In File (34); Requested (16); \ (10); 3rd Attempt (5); 1st Attempt (5); No (3); 2nd Attempt (3); Yes (1) | no |
| 464 | `INV` | 56.4% | NULL (1781); JMF (1600); JVM (700); jmf (1) | no |
| 465 | `SCJ_Evidence` | 1.6% | NULL (4018); Yes  (64) | no |
| 466 | `SCJ_Location` | 1.6% | NULL (4018); SCJ Evidence (62); Normal (2) | no |
| 467 | `SCJ_Exemplar` | 0.1% | NULL (4077); Yes  (5) | no |
| 468 | `Report_Status` | 0.1% | NULL (4077); Yes  (4); No (1) | no |
| 469 | `SCJ_Product_Found` | 0.1% | NULL (4078); No (4) | no |
| 470 | `Claimant` | 0.0% | NULL (4082) | no |
| 471 | `HomePhone` | 7.9% | 291 distinct (too many to list) | no |
| 472 | `Company_ID` | 98.0% | 469 distinct (too many to list) | no |
| 473 | `AddressID` | 94.1% | 619 distinct (too many to list) | no |
| 474 | `ContactID` | 100.0% | 1033 distinct (too many to list) | no |
| 475 | `PK_ID#` | 94.3% | 3849 distinct (too many to list) | no |
| 476 | `Int_Case#` | 100.0% | 4068 distinct (too many to list) | no |
| 477 | `zz.BackMagic.cr` | 0.0% | NULL (4082) | no |
| 478 | `ProductID` | 79.4% | 952 distinct (too many to list) | no |
| 479 | `ManufacturerID` | 30.2% | 235 distinct (too many to list) | no |
| 480 | `DupClient` | 100.0% | 1013 distinct (too many to list) | no |
| 481 | `FC` | 0.0% | NULL (4082) | no |
| 482 | `RC` | 0.0% | NULL (4082) | no |
| 483 | `UnProcessed` | 3.7% | NULL (3931); 1 (151) | no |
| 484 | `Imp_Clients` | 1.1% | NULL (4038); 1 (44) | no |
| 485 | `Imp_Companies` | 1.0% | NULL (4040); 1 (42) | no |
| 486 | `Company_ID#` | 98.0% | 469 distinct (too many to list) | no |
| 487 | `Contact_ID#` | 100.0% | 1033 distinct (too many to list) | no |
| 488 | `Address_ID#` | 94.1% | 619 distinct (too many to list) | no |
| 489 | `Imp_Addresses` | 1.2% | NULL (4033); 1 (49) | no |
| 490 | `Claimant_HomePhone` | 23.9% | 918 distinct (too many to list) | no |
| 491 | `Claimant_WorkPhone` | 5.9% | 176 distinct (too many to list) | no |
| 492 | `Claimant_CellPhone` | 1.5% | 55 distinct (too many to list) | no |
| 493 | `Insured_CellPhone` | 2.0% | 83 distinct (too many to list) | no |
| 494 | `Insured_workPhone` | 3.0% | 103 distinct (too many to list) | no |
| 495 | `Insured_homePhone` | 5.5% | 210 distinct (too many to list) | no |
| 496 | `LawyerID` | 11.9% | 410 distinct (too many to list) | no |
| 497 | `lawFirmID` | 7.6% | 262 distinct (too many to list) | no |
| 498 | `ExpertFirmID1` | 9.5% | 260 distinct (too many to list) | no |
| 499 | `ExpertFirmID2` | 1.7% | 63 distinct (too many to list) | no |
| 500 | `ExpertFirmID3` | 1.0% | 36 distinct (too many to list) | no |
| 501 | `ExpertFirmID4` | 0.2% | NULL (4075); 1401-141364-012811 (1); 1400-320732-012811 (1); 1399-683264-012811 (1); 1398-921158-012811 (1); 1397-118548-012811 (1); 1395-556328-012811 (1); 1314-739926-012811 (1) | no |
| 502 | `ExpertName` | 0.3% | NULL (4070); Ted Pagels (1); Robert Williamson (1); Robert E. Pooler (1); Ray Powell (1); Ralph Long (1); Paul  (Chief) Guilbert (1); Jack Sanderson (1); David Kacprowicz (1); Darryl Henry (1); Cam Cope (1); Bill Mahre (1); Alec Connor (1) | no |
| 503 | `ExpertID1` | 12.0% | 384 distinct (too many to list) | no |
| 504 | `ExpertID2` | 2.1% | 81 distinct (too many to list) | no |
| 505 | `ExpertID3` | 1.6% | 51 distinct (too many to list) | no |
| 506 | `ExpertID4` | 0.3% | NULL (4070); 742-920858-012811 (1); 741-052132-012811 (1); 740-205758-012811 (1); 738-909502-012811 (1); 736-880762-012811 (1); 735-149016-012811 (1); 734-844895-012811 (1); 733-359328-012811 (1); 732-137944-012811 (1); 452-923912-012811 (1); 381-276468-012811 (1); 237-293792-012811 (1) | no |
| 507 | `Expert2Name` | 12.2% | 405 distinct (too many to list) | no |

## Other_Contacts (205 rows, 27 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | NULL (205) | no |
| 2 | `FC` | 0.0% | NULL (205) | no |
| 3 | `One` | 100.0% | 1 (205) | no |
| 4 | `PK_ID#` | 100.0% | 205 distinct (too many to list) | no |
| 5 | `R#` | 0.0% | NULL (205) | no |
| 6 | `RC` | 0.0% | NULL (205) | no |
| 7 | `G_Text` | 0.0% | NULL (205) | no |
| 8 | `G_Num` | 0.0% | NULL (205) | no |
| 9 | `Serial_#` | 100.0% | 205 distinct (too many to list) | no |
| 10 | `Filter` | 0.0% | NULL (205) | no |
| 11 | `S_FilterCount` | 0.0% | NULL (205) | no |
| 12 | `Index` | 0.0% | NULL (205) | no |
| 13 | `G_Index` | 0.0% | NULL (205) | no |
| 14 | `Company_id` | 100.0% | 76 distinct (too many to list) | no |
| 15 | `address_id` | 97.6% | 104 distinct (too many to list) | no |
| 16 | `order_id` | 0.0% | NULL (205) | no |
| 17 | `part_id` | 0.0% | NULL (205) | no |
| 18 | `First_Name` | 97.1% | 131 distinct (too many to list) | yes |
| 19 | `Last_Name` | 79.5% | 132 distinct (too many to list) | yes |
| 20 | `C_Name` | 100.0% | 178 distinct (too many to list) | no |
| 21 | `Category` | 0.0% | NULL (205) | yes |
| 22 | `Title` | 2.4% | NULL (200); Investigator (3); Director (1); CEO (1) | no |
| 23 | `ContactNumbers` | 0.0% | NULL (205) | no |
| 24 | `CaseList` | 0.0% | NULL (205) | no |
| 25 | `cDisplayText` | 0.0% | NULL (205) | no |
| 26 | `#cases` | 0.0% | NULL (205) | no |
| 27 | `C_Name_Display` | 100.0% | 178 distinct (too many to list) | no |

## SR_SearchResults (0 rows, 5 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `SR_SearchString` | 0.0% | (table empty) | no |
| 2 | `SR_ResultText` | 0.0% | (table empty) | no |
| 3 | `SR_ResultLink` | 0.0% | (table empty) | no |
| 4 | `SR_ResultTable` | 0.0% | (table empty) | no |
| 5 | `zz.BackMagic.cr` | 0.0% | (table empty) | no |

## Starter (0 rows, 17 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `zz.BackMagic.cr` | 0.0% | (table empty) | no |
| 2 | `FC` | 0.0% | (table empty) | no |
| 3 | `One` | 0.0% | (table empty) | no |
| 4 | `PK_ID#` | 0.0% | (table empty) | no |
| 5 | `R#` | 0.0% | (table empty) | no |
| 6 | `RC` | 0.0% | (table empty) | no |
| 7 | `G_Text` | 0.0% | (table empty) | no |
| 8 | `G_Num` | 0.0% | (table empty) | no |
| 9 | `Serial_#` | 0.0% | (table empty) | no |
| 10 | `Filter` | 0.0% | (table empty) | no |
| 11 | `S_FilterCount` | 0.0% | (table empty) | no |
| 12 | `Index` | 0.0% | (table empty) | no |
| 13 | `G_Index` | 0.0% | (table empty) | no |
| 14 | `customer_id` | 0.0% | (table empty) | no |
| 15 | `destination_id` | 0.0% | (table empty) | no |
| 16 | `order_id` | 0.0% | (table empty) | no |
| 17 | `part_id` | 0.0% | (table empty) | no |

## dupclients (273 rows, 2 columns)

| # | Column (FileMaker order) | Fill % | Distinct values (≤25) | In new schema? |
|---|---|---|---|---|
| 1 | `f1` | 100.0% | 273 distinct (too many to list) | no |
| 2 | `f2` | 100.0% | 268 distinct (too many to list) | no |