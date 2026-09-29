-- expense.purchase account mapping for the expense module's ledger events.
-- Without these rows the category exports under a key with no external label.

insert into public.ledger_account_map (connector, internal_key, external_id, label)
values
  ('tiller', 'expense.purchase', 'Expenses', 'Operating expenses from receipts'),
  ('wave', 'expense.purchase', 'expense.purchase', 'Operating expenses from receipts')
on conflict (connector, internal_key) do nothing;
