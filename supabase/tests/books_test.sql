-- Kane Books: end-to-end test of the books, bank feed, budgets, recurring bills and home screen.
-- Run on a scratch database built from tests/supabase_stub.sql and files 1 to 5, never production:
--   psql -d scratch -v ON_ERROR_STOP=1 -f tests/books_test.sql
-- Everything runs inside one transaction that is rolled back at the end.
\set ON_ERROR_STOP 1
begin;

-- Signed in as Derek, the way PostgREST does it.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-000000000001","email":"derekkane552@gmail.com","aal":"aal1"}', true);

do $$ begin
  assert public.is_team(), 'Derek should be on the team';
  assert (select count(*) from public.gl_accounts) > 40, 'the starting chart should load';
end $$;

-- Accounts for the test: a card and a brokerage account.
insert into public.gl_accounts (number, name, account_type) values
  ('2000', 'Chase Sapphire', 'Credit Card'), ('1200', 'Brokerage', 'Investment');

create temp table ids as
select (select id from public.gl_accounts where number = '1000') as checking,
       (select id from public.gl_accounts where number = '2000') as card,
       (select id from public.gl_accounts where number = '1200') as brokerage,
       (select id from public.gl_accounts where number = '3000') as opening,
       (select id from public.gl_accounts where number = '4000') as pay,
       (select id from public.gl_accounts where number = '5110') as groceries,
       (select id from public.gl_accounts where number = '5120') as restaurants,
       (select id from public.gl_accounts where number = '5320') as subs,
       (select id from public.gl_accounts where number = '5310') as bizexp,
       (select id from public.gl_accounts where number = '4200') as side;
grant select on ids to authenticated;

-- Opening balances: $5,000 in checking, $800 owed on the card, $20,000 in the brokerage.
select public.save_ledger_entry(
  jsonb_build_object('entry_type', 'opening', 'entry_date', '2026-01-01', 'memo', 'Opening balances'),
  jsonb_build_array(
    jsonb_build_object('gl_account_id', (select checking from ids), 'debit', 5000),
    jsonb_build_object('gl_account_id', (select brokerage from ids), 'debit', 20000),
    jsonb_build_object('gl_account_id', (select card from ids), 'credit', 800),
    jsonb_build_object('gl_account_id', (select opening from ids), 'credit', 24200)));

-- An entry that does not balance is refused.
do $$ begin
  begin
    perform public.save_ledger_entry(
      jsonb_build_object('entry_type', 'journal', 'entry_date', '2026-01-02'),
      jsonb_build_array(jsonb_build_object('gl_account_id', (select checking from ids), 'debit', 10),
                        jsonb_build_object('gl_account_id', (select pay from ids), 'credit', 9)));
    set constraints all immediate;
    raise exception 'should not get here';
  exception when others then
    assert sqlerrm like '%does not balance%', 'unbalanced entry should be refused, got ' || sqlerrm;
  end;
end $$;

-- A project for a side business.
insert into public.projects (name, is_business) values ('Venture City', true);

-- Bank feed: checking and the card, transactions uploaded as statements.
insert into public.bank_feed_accounts (era_account_key, name, gl_account_id)
select 'k-checking', 'Wintrust Checking', checking from ids;
insert into public.bank_feed_accounts (era_account_key, name, gl_account_id)
select 'k-card', 'Chase Sapphire', card from ids;

create temp table feeds as
select (select id from public.bank_feed_accounts where era_account_key = 'k-checking') as chk,
       (select id from public.bank_feed_accounts where era_account_key = 'k-card') as crd;
grant select on feeds to authenticated;

select public.bank_import_statement((select chk from feeds), '[
  {"txn_date":"2026-02-01","amount":3000,"description":"ACME PAYROLL"},
  {"txn_date":"2026-02-15","amount":3000,"description":"ACME PAYROLL"},
  {"txn_date":"2026-02-20","amount":-500,"description":"CHASE CARD PAYMENT"},
  {"txn_date":"2026-02-25","amount":-120.50,"description":"JEWEL OSCO 123"}
]'::jsonb);
select public.bank_import_statement((select crd from feeds), '[
  {"txn_date":"2026-02-21","amount":500,"description":"PAYMENT THANK YOU"},
  {"txn_date":"2026-02-22","amount":-64.20,"description":"PORTILLOS"},
  {"txn_date":"2026-02-23","amount":-49,"description":"CANVA PRO"}
]'::jsonb);

-- Netflix, monthly, the last charge a few days ago.
select public.bank_import_statement((select crd from feeds), jsonb_build_array(
  jsonb_build_object('txn_date', current_date - 65, 'amount', -15.99, 'description', 'NETFLIX.COM 866'),
  jsonb_build_object('txn_date', current_date - 34, 'amount', -15.99, 'description', 'NETFLIX.COM 866'),
  jsonb_build_object('txn_date', current_date - 4, 'amount', -15.99, 'description', 'NETFLIX.COM 866')));

-- Uploading the same statement again adds nothing.
do $$
declare r jsonb;
begin
  r := public.bank_import_statement((select chk from feeds), '[
    {"txn_date":"2026-02-01","amount":3000,"description":"ACME PAYROLL"},
    {"txn_date":"2026-02-15","amount":3000,"description":"ACME PAYROLL"}]'::jsonb);
  assert (r->>'added')::int = 0 and (r->>'already_in')::int = 2, 're-upload should add nothing: ' || r;
end $$;

-- Paychecks: add the first with a rule that adds the rest automatically.
select public.bank_accept(
  (select id from public.bank_transactions where description = 'ACME PAYROLL' order by txn_date limit 1),
  null, 'Paycheck', jsonb_build_array(jsonb_build_object('amount', 3000, 'gl_account_id', (select pay from ids))),
  '{"contains":"ACME PAYROLL","auto_add":true}'::jsonb, 'Acme Corp');
select public.bank_autoprocess();
do $$ begin
  assert (select count(*) from public.bank_transactions where description = 'ACME PAYROLL' and status = 'added') = 2,
    'the rule should add the second paycheck';
  assert (select count(*) from public.payees where name = 'Acme Corp') = 1, 'payee should be added by name';
end $$;

-- Card payment from checking: a transfer. The card side then matches it automatically.
select public.bank_accept(
  (select id from public.bank_transactions where description = 'CHASE CARD PAYMENT'),
  null, 'Card payment', jsonb_build_array(jsonb_build_object('amount', 500, 'gl_account_id', (select card from ids))));
select public.bank_autoprocess();
do $$ begin
  assert (select entry_type from public.ledger_entries where memo = 'Card payment') = 'transfer', 'card payment is a transfer';
  assert (select status from public.bank_transactions where description = 'PAYMENT THANK YOU') = 'matched',
    'the card side of the payment should match the transfer';
end $$;

-- Groceries split between groceries and restaurants; Canva tagged to the project.
select public.bank_accept(
  (select id from public.bank_transactions where description = 'JEWEL OSCO 123'), null, null,
  jsonb_build_array(jsonb_build_object('amount', 100, 'gl_account_id', (select groceries from ids)),
                    jsonb_build_object('amount', 20.50, 'gl_account_id', (select restaurants from ids))));
select public.bank_accept(
  (select id from public.bank_transactions where description = 'CANVA PRO'), null, null,
  jsonb_build_array(jsonb_build_object('amount', 49, 'gl_account_id', (select bizexp from ids),
                                       'project_id', (select id from public.projects where name = 'Venture City'))));
select public.bank_accept(
  (select id from public.bank_transactions where description = 'PORTILLOS'), null, null,
  jsonb_build_array(jsonb_build_object('amount', 64.20, 'gl_account_id', (select restaurants from ids))));

-- Netflix charges: leave them for review, they should be found as a recurring bill.
do $$
declare c record;
begin
  select * into c from public.recurring_candidates() where merchant_key like 'NETFLIX%';
  assert c.cadence = 'monthly', 'Netflix should look monthly, got ' || coalesce(c.cadence, 'nothing');
  assert c.times = 3, 'three Netflix charges';
end $$;
insert into public.recurring_bills (name, amount, cadence, match_text, gl_account_id)
select 'Netflix', 15.99, 'monthly', 'NETFLIX', subs from ids;
do $$ begin
  assert (select last_seen from public.v_recurring_bills where name = 'Netflix') = current_date - 4, 'last Netflix charge';
  assert (select next_expected from public.v_recurring_bills where name = 'Netflix') = (current_date - 4 + interval '1 month')::date,
    'next Netflix charge';
  assert not exists (select 1 from public.recurring_candidates() where merchant_key like 'NETFLIX%'),
    'a bill already set up is not suggested again';
end $$;

-- A bill matched by the cleaned-up merchant key ("NETFLIX COM") works too, and a dismissed suggestion stays gone.
update public.recurring_bills set match_text = 'NETFLIX COM' where name = 'Netflix';
do $$ begin
  assert (select times_seen from public.v_recurring_bills where name = 'Netflix') = 3, 'matched by merchant key';
end $$;
select public.bank_import_statement((select chk from feeds), jsonb_build_array(
  jsonb_build_object('txn_date', current_date - 70, 'amount', -9.99, 'description', 'SPOTIFY USA'),
  jsonb_build_object('txn_date', current_date - 40, 'amount', -9.99, 'description', 'SPOTIFY USA'),
  jsonb_build_object('txn_date', current_date - 10, 'amount', -9.99, 'description', 'SPOTIFY USA')));
do $$ begin
  assert exists (select 1 from public.recurring_candidates() where merchant_key = 'SPOTIFY USA'), 'Spotify found';
end $$;
insert into public.recurring_dismissed (merchant_key) values ('SPOTIFY USA');
do $$ begin
  assert not exists (select 1 from public.recurring_candidates() where merchant_key = 'SPOTIFY USA'), 'dismissed stays gone';
end $$;

-- Payee activity.
do $$ begin
  assert (select sum(amount) from public.report_payee_activity(
            (select id from public.payees where name = 'Acme Corp'), '2026-01-01', '2026-12-31')) = -6000,
    'Acme paid 6000 (income lines are credits)';
end $$;

-- Undo puts a transaction back and removes the entry.
do $$
declare t uuid := (select id from public.bank_transactions where description = 'PORTILLOS');
begin
  perform public.bank_undo(t);
  assert (select status from public.bank_transactions where id = t) = 'new', 'undo puts it back';
  assert not exists (select 1 from public.ledger_entries where external_ref like 'era:%' and memo = 'PORTILLOS'),
    'undo removes the entry';
  perform public.bank_exclude(t);
  assert (select status from public.bank_transactions where id = t) = 'excluded', 'exclude';
end $$;

-- Investment value: the brokerage is now worth $21,250.
do $$
declare d numeric;
begin
  d := public.post_valuation((select brokerage from ids), '2026-03-31', 21250);
  assert d = 1250, 'value change should be 1250, got ' || d;
  -- Same day again replaces it.
  d := public.post_valuation((select brokerage from ids), '2026-03-31', 21000);
  assert d = 1000, 'second update replaces the first, got ' || d;
  assert (select count(*) from public.ledger_entries where entry_type = 'valuation') = 1, 'one valuation per day';
end $$;

-- Reports.
do $$
declare nw numeric; inc numeric; sp numeric; biz record;
begin
  select balance into nw from public.account_balances('2026-03-31') where account_name = 'Brokerage';
  assert nw = 21000, 'brokerage balance 21000, got ' || nw;
  select sum(amount) into inc from public.report_profit_and_loss('2026-01-01', '2026-12-31') where section = 'Income';
  assert inc = 6000, 'income 6000, got ' || inc;
  select sum(amount) into sp from public.report_profit_and_loss('2026-01-01', '2026-12-31') where section = 'Spending';
  assert sp = 169.50, 'spending 169.50, got ' || sp;
  select * into biz from public.report_pl_by_project('2026-01-01', '2026-12-31') where project_name = 'Venture City';
  assert biz.spending = 49 and biz.is_business, 'project spending 49';
  -- Balance sheet: own 5000 + 6000 - 500 - 120.50 = 10379.50 cash, 21000 brokerage; owe 800 - 500 + 49 = 349.
  select sum(balance) filter (where section = 'What you own') - sum(balance) filter (where section = 'What you owe')
    into nw from public.report_balance_sheet('2026-12-31');
  assert nw = 10379.50 + 21000 - 349, 'net worth, got ' || nw;
  assert (select sum(balance) from public.report_balance_sheet('2026-12-31') where section = 'Net worth') = nw,
    'net worth section equals own less owe';
  assert (select sum(debit) - sum(credit) from public.report_trial_balance('2026-12-31')) = 0, 'trial balance balances';
  assert (select amount from public.report_tax_summary('2026-01-01', '2026-12-31') where tax_line = 'Wages (W-2)') = 6000,
    'wages on the tax summary';
  assert (select count(*) from public.report_net_worth_series('2026-01-01', '2026-04-30')) = 4, 'four month ends';
  assert (select net_worth from public.report_net_worth_series('2026-01-01', '2026-04-30') order by month_end limit 1)
         = 24200, 'January net worth is the opening equity';
end $$;

-- Budgets: $300 a month for restaurants, $25 override for February.
insert into public.budget_amounts (gl_account_id, month, amount) select restaurants, null, 300 from ids;
insert into public.budget_amounts (gl_account_id, month, amount) select restaurants, '2026-02-01', 25 from ids;
do $$
declare b record;
begin
  select * into b from public.report_budget('2026-02-10') where account_name = 'Dining out';
  assert b.budget = 25 and b.budget_is_override and b.actual = 20.50 and b.remaining = 4.50, 'February budget ' || row_to_json(b);
  select * into b from public.report_budget('2026-03-10') where account_name = 'Dining out';
  assert b.budget = 300 and not b.budget_is_override, 'March uses the usual amount';
  assert (select count(*) from public.report_budget_year(2026) where gl_account_id = (select restaurants from ids)) = 12,
    'a year of budget rows';
end $$;

-- Reconcile checking through Feb 28: statement $10,379.50.
insert into public.reconciliations (gl_account_id, statement_date, statement_ending_balance)
select checking, '2026-02-28', 10379.50 from ids;
insert into public.reconciliation_items (reconciliation_id, gl_account_id, source, source_id)
select r.id, r.gl_account_id, u.source, u.source_id
from public.reconciliations r join public.v_uncleared u on u.gl_account_id = r.gl_account_id and u.txn_date <= r.statement_date;
update public.reconciliations set status = 'completed' where statement_date = '2026-02-28';
do $$ begin
  assert (select difference from public.v_reconciliation_status where statement_date = '2026-02-28') = 0, 'reconciles';
  -- A reconciled entry can't change amount.
  begin
    update public.ledger_entries set entry_date = '2026-02-02' where memo = 'Card payment';
    raise exception 'should not get here';
  exception when others then
    assert sqlerrm like '%completed reconciliation%', 'reconciled entries are locked, got ' || sqlerrm;
  end;
end $$;

-- Closed books lock the period.
update public.book_settings set books_closed_through = '2026-02-28' where id = 1;
do $$ begin
  begin
    perform public.save_ledger_entry(
      jsonb_build_object('entry_type', 'journal', 'entry_date', '2026-02-10'),
      jsonb_build_array(jsonb_build_object('gl_account_id', (select checking from ids), 'debit', 1),
                        jsonb_build_object('gl_account_id', (select pay from ids), 'credit', 1)));
    raise exception 'should not get here';
  exception when others then
    assert sqlerrm like '%closed through%', 'closed period locked, got ' || sqlerrm;
  end;
end $$;
update public.book_settings set books_closed_through = null where id = 1;

-- Home screen.
do $$
declare h jsonb := public.home_summary(current_date);
begin
  assert (h->'totals'->>'net_worth')::numeric = 10379.50 + 21000 - 349, 'home net worth ' || (h->'totals');
  assert jsonb_array_length(h->'accounts') >= 3, 'accounts on home';
  assert jsonb_array_length(h->'net_worth_series') = 12, 'twelve months of net worth (no start date set)';
  assert exists (select 1 from jsonb_array_elements(h->'attention') a where a->>'kind' = 'review'),
    'Netflix charges are waiting for review';
  assert (h->'recurring'->>'monthly_bills')::numeric = 15.99, 'recurring bills a month';
  assert not exists (select 1 from jsonb_array_elements(h->'upcoming') a where a->>'name' = 'Netflix'),
    'Netflix is about four weeks out, not in the next 14 days';
end $$;

-- Someone not on the list sees nothing.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000009","email":"someone@else.com"}', true);
do $$ begin
  assert not public.is_team(), 'a stranger is not on the team';
  assert (select count(*) from public.gl_accounts) = 0, 'a stranger sees no accounts';
  assert (select count(*) from public.ledger_entries) = 0, 'a stranger sees no entries';
end $$;

-- Logged out sees nothing at all.
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.gl_accounts limit 1;
    raise exception 'should not get here';
  exception when insufficient_privilege then null;
  end;
  assert public.keepalive() = 1, 'keepalive works logged out';
end $$;

reset role;
select 'books test passed' as result;
rollback;
