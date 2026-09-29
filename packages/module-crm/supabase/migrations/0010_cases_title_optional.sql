-- A case may have no title.
--
-- 0007_cases.sql made title NOT NULL, which is right for a case opened in this
-- product: routes.ts rejects a create without one, and it is the thing staff
-- read in a list. It is wrong for a case file that predates the product.
--
-- ElectroTek's FileMaker register has no title field. It was measured before
-- this was written: the only fields populated in all 3,850 cases are
-- identifiers, the date and the status. The nearest candidate, Case#_Txt, holds
-- values like 6417-810969-121011 — an internal composite, not a title — and
-- putting that in the column staff read would be worse than leaving it empty.
-- What the source does have is Product, populated in 2,823 of 3,850 rows and
-- actually descriptive ("Gateway Model M25-E Notebook Computer"). That maps to
-- title, and the remaining 1,027 cases carry none.
--
-- No application change is needed. caseFromRow already reads the column as
-- `stringOrNull(row.title) ?? ""` and the case list already renders `title ?? "—"`,
-- so a null arrives as an empty title rather than as a crash. The API-level
-- requirement in routes.ts is deliberately left alone: a case someone opens in
-- the product still has to be given a title. This only stops the database from
-- refusing history that never had one.

alter table public.cases
  alter column title drop not null;
