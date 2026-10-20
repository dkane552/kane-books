-- Kane Books demo data, for looking at the app on a scratch database (never production). Made-up
-- accounts and amounts: ten months of paychecks, rent, groceries, a card, savings, a brokerage account, a
-- side business and a few transactions left for review. Run after files 1 to 5 as postgres.
\set ON_ERROR_STOP 1

update public.book_settings set ledger_start_date = (date_trunc('month', current_date) - interval '10 months')::date,
  bank_feed_start_date = (date_trunc('month', current_date) - interval '10 months')::date where id = 1;

insert into public.gl_accounts (number, name, account_type, institution) values
  ('2000', 'Chase Sapphire', 'Credit Card', 'Chase'),
  ('1200', 'Fidelity Brokerage', 'Investment', 'Fidelity'),
  ('1300', '401(k)', 'Retirement', 'Fidelity'),
  ('1500', '2021 Tacoma', 'Vehicle', null),
  ('2500', 'Auto loan', 'Loan', 'Ally')
on conflict do nothing;

insert into public.projects (name, description, is_business) values
  ('Venture City', 'Etsy posters, Gumroad kits and TikTok Shop', true),
  ('Trading bot', 'Automated trading test account', true)
on conflict do nothing;

do $$
declare
  s date := (date_trunc('month', current_date) - interval '10 months')::date;
  chk uuid; crd uuid; bro uuid; k401 uuid; car uuid; loan uuid; eq uuid;
  f_chk uuid; f_crd uuid; d date; m int; rows jsonb := '[]'::jsonb; crows jsonb := '[]'::jsonb;
  acct record;
begin
  select id into chk from public.gl_accounts where number = '1000';
  select id into crd from public.gl_accounts where number = '2000';
  select id into bro from public.gl_accounts where number = '1200';
  select id into k401 from public.gl_accounts where number = '1300';
  select id into car from public.gl_accounts where number = '1500';
  select id into loan from public.gl_accounts where number = '2500';
  select id into eq from public.gl_accounts where number = '3000';

  -- Opening balances.
  perform public.save_ledger_entry(
    jsonb_build_object('entry_type', 'opening', 'entry_date', s, 'memo', 'Opening balances'),
    jsonb_build_array(
      jsonb_build_object('gl_account_id', chk, 'debit', 6200),
      jsonb_build_object('gl_account_id', (select id from public.gl_accounts where number = '1010'), 'debit', 12000),
      jsonb_build_object('gl_account_id', bro, 'debit', 18500),
      jsonb_build_object('gl_account_id', k401, 'debit', 24300),
      jsonb_build_object('gl_account_id', car, 'debit', 27000),
      jsonb_build_object('gl_account_id', crd, 'credit', 1150),
      jsonb_build_object('gl_account_id', loan, 'credit', 14800),
      jsonb_build_object('gl_account_id', eq, 'credit', 72050)));

  insert into public.bank_feed_accounts (era_account_key, name, institution, mask, account_type, gl_account_id, balance)
  values ('demo-chk', 'Total Checking', 'Wintrust', '4821', 'checking', chk, null),
         ('demo-crd', 'Sapphire Preferred', 'Chase', '4417', 'credit card', crd, null);
  select id into f_chk from public.bank_feed_accounts where era_account_key = 'demo-chk';
  select id into f_crd from public.bank_feed_accounts where era_account_key = 'demo-crd';

  for m in 0..10 loop
    d := (s + make_interval(months => m))::date;
    exit when d > current_date;
    -- Checking: paychecks on the 1st and 15th, rent, utilities, phone, loan, card payment, savings.
    rows := rows || jsonb_build_array(
      jsonb_build_object('txn_date', d, 'amount', 2450, 'description', 'SPYGLASS INC PAYROLL'),
      jsonb_build_object('txn_date', least(d + 14, current_date), 'amount', 2450, 'description', 'SPYGLASS INC PAYROLL'),
      jsonb_build_object('txn_date', d + 2, 'amount', -1650, 'description', 'ZELLE TO ORLAND APTS RENT'),
      jsonb_build_object('txn_date', d + 5, 'amount', -(78 + (m * 7) % 40), 'description', 'COMED ELECTRIC'),
      jsonb_build_object('txn_date', d + 6, 'amount', -65, 'description', 'XFINITY INTERNET'),
      jsonb_build_object('txn_date', d + 8, 'amount', -85, 'description', 'VERIZON WIRELESS'),
      jsonb_build_object('txn_date', d + 10, 'amount', -412.37, 'description', 'ALLY AUTO PAYMENT'),
      jsonb_build_object('txn_date', d + 20, 'amount', -500, 'description', 'TRANSFER TO SAVINGS 7731'),
      jsonb_build_object('txn_date', d + 12, 'amount', -(760 + (m * 37) % 120), 'description', 'CHASE CREDIT CRD AUTOPAY'),
      jsonb_build_object('txn_date', d + 18, 'amount', 180 + (m * 37) % 160, 'description', 'ETSY INC DEPOSIT')
    );
    -- Card: groceries weekly, restaurants, gas, subscriptions, the side business, the payment.
    crows := crows || jsonb_build_array(
      jsonb_build_object('txn_date', d + 3, 'amount', -(96 + (m * 11) % 50), 'description', 'JEWEL OSCO #3321'),
      jsonb_build_object('txn_date', d + 10, 'amount', -(112 + (m * 13) % 45), 'description', 'JEWEL OSCO #3321'),
      jsonb_build_object('txn_date', d + 17, 'amount', -(88 + (m * 17) % 60), 'description', 'MARIANOS 512'),
      jsonb_build_object('txn_date', d + 24, 'amount', -(101 + (m * 19) % 40), 'description', 'JEWEL OSCO #3321'),
      jsonb_build_object('txn_date', d + 4, 'amount', -(38 + (m * 3) % 25), 'description', 'PORTILLOS ORLAND PARK'),
      jsonb_build_object('txn_date', d + 13, 'amount', -(64 + (m * 9) % 70), 'description', 'BUFFALO WILD WINGS'),
      jsonb_build_object('txn_date', d + 21, 'amount', -(22 + (m * 5) % 20), 'description', 'STARBUCKS STORE 2210'),
      jsonb_build_object('txn_date', d + 7, 'amount', -(55 + (m * 7) % 20), 'description', 'SHELL OIL 57442'),
      jsonb_build_object('txn_date', d + 22, 'amount', -(58 + (m * 11) % 25), 'description', 'SHELL OIL 57442'),
      jsonb_build_object('txn_date', d + 3, 'amount', -15.49, 'description', 'NETFLIX.COM'),
      jsonb_build_object('txn_date', d + 9, 'amount', -11.99, 'description', 'SPOTIFY USA'),
      jsonb_build_object('txn_date', d + 1, 'amount', -39.99, 'description', 'LA FITNESS'),
      jsonb_build_object('txn_date', d + 15, 'amount', -14.99, 'description', 'CANVA* PRO'),
      jsonb_build_object('txn_date', d + 16, 'amount', -(42 + (m * 13) % 50), 'description', 'PRINTFUL INC'),
      jsonb_build_object('txn_date', d + 12, 'amount', 760 + (m * 37) % 120, 'description', 'AUTOMATIC PAYMENT - THANK YOU')
    );
  end loop;
  -- Only what has happened by today.
  select coalesce(jsonb_agg(x), '[]') into rows from jsonb_array_elements(rows) x where (x->>'txn_date')::date <= current_date;
  select coalesce(jsonb_agg(x), '[]') into crows from jsonb_array_elements(crows) x where (x->>'txn_date')::date <= current_date;

  -- Rules first, so the history goes straight into the books.
  insert into public.bank_rules (contains, gl_account_id, payee_id, auto_add, direction) values
    ('SPYGLASS INC PAYROLL', (select id from public.gl_accounts where number = '4000'), public.payee_for('Spyglass Inc'), true, 'in'),
    ('ORLAND APTS', (select id from public.gl_accounts where number = '5010'), public.payee_for('Orland Apartments'), true, 'out'),
    ('COMED', (select id from public.gl_accounts where number = '5030'), public.payee_for('ComEd'), true, 'out'),
    ('XFINITY', (select id from public.gl_accounts where number = '5030'), public.payee_for('Xfinity'), true, 'out'),
    ('VERIZON', (select id from public.gl_accounts where number = '5030'), public.payee_for('Verizon'), true, 'out'),
    ('ALLY AUTO', loan, public.payee_for('Ally'), true, 'out'),
    ('TRANSFER TO SAVINGS', (select id from public.gl_accounts where number = '1010'), null, true, 'out'),
    ('CHASE CREDIT CRD', crd, null, true, 'out'),
    ('JEWEL OSCO', (select id from public.gl_accounts where number = '5110'), public.payee_for('Jewel-Osco'), true, 'out'),
    ('MARIANOS', (select id from public.gl_accounts where number = '5110'), public.payee_for('Mariano''s'), true, 'out'),
    ('PORTILLOS', (select id from public.gl_accounts where number = '5120'), public.payee_for('Portillo''s'), true, 'out'),
    ('BUFFALO WILD', (select id from public.gl_accounts where number = '5120'), public.payee_for('Buffalo Wild Wings'), true, 'out'),
    ('STARBUCKS', (select id from public.gl_accounts where number = '5130'), public.payee_for('Starbucks'), true, 'out'),
    ('SHELL OIL', (select id from public.gl_accounts where number = '5210'), public.payee_for('Shell'), true, 'out'),
    ('NETFLIX', (select id from public.gl_accounts where number = '5320'), public.payee_for('Netflix'), true, 'out'),
    ('SPOTIFY', (select id from public.gl_accounts where number = '5320'), public.payee_for('Spotify'), true, 'out'),
    ('LA FITNESS', (select id from public.gl_accounts where number = '5330'), public.payee_for('LA Fitness'), true, 'out');
  insert into public.bank_rules (contains, gl_account_id, project_id, payee_id, auto_add, direction) values
    ('ETSY INC', (select id from public.gl_accounts where number = '4200'), (select id from public.projects where name = 'Venture City'), public.payee_for('Etsy'), true, 'in'),
    ('CANVA', (select id from public.gl_accounts where number = '5320'), (select id from public.projects where name = 'Venture City'), public.payee_for('Canva'), true, 'out'),
    ('PRINTFUL', (select id from public.gl_accounts where number = '5310'), (select id from public.projects where name = 'Venture City'), public.payee_for('Printful'), false, 'out');

  perform public.bank_import_statement(f_chk, rows);
  perform public.bank_import_statement(f_crd, crows);

  -- A few new ones waiting for review.
  perform public.bank_import_statement(f_crd, jsonb_build_array(
    jsonb_build_object('txn_date', current_date - 3, 'amount', -86.42, 'description', 'AMAZON MKTPL*2K4'),
    jsonb_build_object('txn_date', current_date - 2, 'amount', -129.00, 'description', 'HOME DEPOT 1922'),
    jsonb_build_object('txn_date', current_date - 1, 'amount', -18.75, 'description', 'CHIPOTLE 2291')));

  -- Monthly value updates for the brokerage and the 401(k), and the truck losing value.
  for m in 0..10 loop
    d := ((s + make_interval(months => m + 1)) - interval '1 day')::date;
    exit when d > current_date;
    perform public.post_valuation(bro, d, 18500 + m * 520 + (m % 3) * 310);
    perform public.post_valuation(k401, d, 24300 + m * 760);
    perform public.post_valuation(car, d, 27000 - m * 260);
  end loop;

  -- Budgets.
  for acct in select id, number from public.gl_accounts where number in ('5010','5030','5110','5120','5130','5210','5330','5320','5310') loop
    insert into public.budget_amounts (gl_account_id, month, amount)
    values (acct.id, null, case acct.number when '5010' then 1650 when '5030' then 260
      when '5110' then 450 when '5120' then 150 when '5130' then 30 when '5210' then 140
      when '5330' then 40 when '5320' then 30 else 60 end);
  end loop;
  insert into public.budget_amounts (gl_account_id, month, amount)
  select id, null, 4900 from public.gl_accounts where number = '4000';

  -- Recurring bills.
  insert into public.recurring_bills (name, amount, cadence, match_text, gl_account_id, is_income) values
    ('Rent', 1650, 'monthly', 'ORLAND APTS', (select id from public.gl_accounts where number = '5010'), false),
    ('Netflix', 15.49, 'monthly', 'NETFLIX', (select id from public.gl_accounts where number = '5320'), false),
    ('Car payment', 412.37, 'monthly', 'ALLY AUTO', loan, false),
    ('Paycheck', 2450, 'semimonthly', 'SPYGLASS INC PAYROLL', (select id from public.gl_accounts where number = '4000'), true);
end $$;

select 'demo data loaded' as result,
       (select count(*) from public.ledger_entries) as entries,
       (select count(*) from public.bank_transactions where status = 'new') as for_review;
