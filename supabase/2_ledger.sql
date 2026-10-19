-- Kane Books: the books. Run after 1_base.sql. Safe to re-run.
--
-- Double-entry, like QuickBooks, so the balance sheet is a true net worth statement:
--   * gl_accounts is the chart: what you own (bank, investments, retirement, property, vehicles), what you
--     owe (cards, loans, mortgage), net worth (equity), and the categories money comes from and goes to
--     (income and expense accounts, grouped by category_group for budgets and reports).
--   * ledger_entries + ledger_lines hold every transaction: expenses, deposits, transfers, journal entries,
--     opening balances and valuations (a change in what an investment, house or car is worth).
--   * v_gl is the general ledger every report reads. Amounts are signed debit positive, credit negative.
--   * Projects (side ventures, a trip, a renovation) tag lines for a profit and loss per project.
--   * tax_line on an account (or on one line) puts it on the tax summary for the CPA.
--
-- Locks: book_settings.books_closed_through locks everything dated on or before it, and completed
-- reconciliations lock their items. The SQL editor (postgres) is not blocked; audit_log records everything.

-- =====================================================================================
-- 1. Chart of accounts
-- =====================================================================================
create table if not exists public.gl_accounts (
  id uuid primary key default gen_random_uuid(),
  number text,
  name text not null,
  account_type text not null check (account_type in (
    'Bank','Investment','Retirement','Property','Vehicle','Other Asset',
    'Credit Card','Loan','Mortgage','Other Liability','Equity',
    'Income','Expense','Other Income','Other Expense')),
  classification text generated always as (case
    when account_type in ('Bank','Investment','Retirement','Property','Vehicle','Other Asset') then 'Asset'
    when account_type in ('Credit Card','Loan','Mortgage','Other Liability') then 'Liability'
    when account_type = 'Equity' then 'Equity'
    when account_type in ('Income','Other Income') then 'Revenue'
    else 'Expense' end) stored,
  -- Accounts whose value moves on its own (markets, home prices, depreciation) get valuation entries.
  is_valued boolean generated always as (account_type in ('Investment','Retirement','Property','Vehicle','Other Asset')) stored,
  category_group text,
  tax_line text,
  description text,
  institution text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists gl_accounts_number_key on public.gl_accounts(number) where number is not null;
create unique index if not exists gl_accounts_name_key on public.gl_accounts(lower(name));

-- Starting chart. Bank, card and investment accounts are added when they are linked to the bank feed
-- (or by hand in Accounts); the categories below can be renamed, merged or switched off.
insert into public.gl_accounts (number, name, account_type, category_group, tax_line) values
  ('1000','Checking','Bank',null,null),
  ('1010','Savings','Bank',null,null),
  ('1090','Cash on hand','Bank',null,null),
  ('3000','Opening balance equity','Equity',null,null),
  ('3900','Net worth carried forward','Equity',null,null),
  ('4000','Paychecks','Income','Income','Wages (W-2)'),
  ('4100','Business distributions','Income','Income','Business distributions (K-1)'),
  ('4200','Side income','Income','Income',null),
  ('4300','Interest','Income','Income','Interest income (1099-INT)'),
  ('4400','Dividends','Income','Income','Dividends (1099-DIV)'),
  ('4500','Refunds and reimbursements','Income','Income',null),
  ('4600','Gifts received','Income','Income',null),
  ('4900','Other income','Income','Income',null),
  ('5010','Rent','Expense','Housing',null),
  ('5020','Mortgage interest','Expense','Housing','Mortgage interest (Schedule A)'),
  ('5030','Property taxes','Expense','Housing','State and local taxes (Schedule A)'),
  ('5040','Home insurance','Expense','Housing',null),
  ('5050','Home maintenance','Expense','Housing',null),
  ('5060','Furniture and household','Expense','Housing',null),
  ('5110','Electric and gas','Expense','Utilities',null),
  ('5120','Water and trash','Expense','Utilities',null),
  ('5130','Internet and TV','Expense','Utilities',null),
  ('5140','Phone','Expense','Utilities',null),
  ('5210','Groceries','Expense','Food',null),
  ('5220','Restaurants','Expense','Food',null),
  ('5230','Coffee','Expense','Food',null),
  ('5310','Gas and fuel','Expense','Transportation',null),
  ('5320','Auto insurance','Expense','Transportation',null),
  ('5330','Auto maintenance','Expense','Transportation',null),
  ('5340','Parking and tolls','Expense','Transportation',null),
  ('5350','Rideshare and transit','Expense','Transportation',null),
  ('5360','Auto loan interest','Expense','Transportation',null),
  ('5410','Health insurance','Expense','Health','Medical (Schedule A)'),
  ('5420','Doctor and dentist','Expense','Health','Medical (Schedule A)'),
  ('5430','Pharmacy','Expense','Health','Medical (Schedule A)'),
  ('5440','Fitness','Expense','Health',null),
  ('5510','Clothing','Expense','Personal',null),
  ('5520','Personal care','Expense','Personal',null),
  ('5530','Subscriptions','Expense','Personal',null),
  ('5540','Entertainment','Expense','Personal',null),
  ('5550','Hobbies','Expense','Personal',null),
  ('5560','Travel','Expense','Personal',null),
  ('5570','Gifts given','Expense','Personal',null),
  ('5580','Charitable giving','Expense','Personal','Charitable contributions (Schedule A)'),
  ('5610','Bank and card fees','Expense','Financial',null),
  ('5620','Interest paid','Expense','Financial',null),
  ('5630','Tax prep and legal','Expense','Financial',null),
  ('5710','Courses and licenses','Expense','Education',null),
  ('5720','Books and learning','Expense','Education',null),
  ('5730','Student loan interest','Expense','Education','Student loan interest'),
  ('5810','Federal income tax','Expense','Taxes','Federal tax payments'),
  ('5820','State income tax','Expense','Taxes','State and local taxes (Schedule A)'),
  ('5830','Other taxes','Expense','Taxes',null),
  ('5910','Business expenses','Expense','Business',null),
  ('5920','Software and tools','Expense','Business',null),
  ('5990','Uncategorized expense','Expense','Other',null),
  ('4990','Uncategorized income','Income','Income',null),
  ('7000','Investment and asset value changes','Other Income','Value changes',null),
  ('7900','Reconciliation discrepancies','Other Expense','Other',null)
on conflict do nothing;

update public.book_settings s set
  default_cash_gl_id          = coalesce(s.default_cash_gl_id,          (select id from public.gl_accounts where number = '1000')),
  opening_equity_gl_id        = coalesce(s.opening_equity_gl_id,        (select id from public.gl_accounts where number = '3000')),
  net_worth_carried_gl_id     = coalesce(s.net_worth_carried_gl_id,     (select id from public.gl_accounts where number = '3900')),
  value_change_gl_id          = coalesce(s.value_change_gl_id,          (select id from public.gl_accounts where number = '7000')),
  uncategorized_expense_gl_id = coalesce(s.uncategorized_expense_gl_id, (select id from public.gl_accounts where number = '5990')),
  uncategorized_income_gl_id  = coalesce(s.uncategorized_income_gl_id,  (select id from public.gl_accounts where number = '4990'))
where s.id = 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'book_settings_cash_fk') then
    alter table public.book_settings
      add constraint book_settings_cash_fk foreign key (default_cash_gl_id) references public.gl_accounts(id),
      add constraint book_settings_carried_fk foreign key (net_worth_carried_gl_id) references public.gl_accounts(id),
      add constraint book_settings_opening_fk foreign key (opening_equity_gl_id) references public.gl_accounts(id),
      add constraint book_settings_value_fk foreign key (value_change_gl_id) references public.gl_accounts(id),
      add constraint book_settings_unc_exp_fk foreign key (uncategorized_expense_gl_id) references public.gl_accounts(id),
      add constraint book_settings_unc_inc_fk foreign key (uncategorized_income_gl_id) references public.gl_accounts(id);
  end if;
end $$;

-- =====================================================================================
-- 2. Ledger entries
-- =====================================================================================
create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('expense','deposit','transfer','journal','valuation','opening')),
  entry_date date not null,
  number text,
  payee_id uuid references public.payees(id) on delete set null,
  memo text,
  total numeric(14,2) not null default 0,       -- sum of debits
  is_void boolean not null default false,
  external_ref text,                            -- bank feed id or valuation key, so nothing lands twice
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ledger_entries_external_ref_key on public.ledger_entries(external_ref) where external_ref is not null;
create index if not exists ledger_entries_date_idx on public.ledger_entries(entry_date);

create table if not exists public.ledger_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.ledger_entries(id) on delete cascade,
  position int not null default 1,
  gl_account_id uuid not null references public.gl_accounts(id),
  debit numeric(14,2) not null default 0 check (debit >= 0),
  credit numeric(14,2) not null default 0 check (credit >= 0),
  description text,
  project_id uuid references public.projects(id) on delete set null,
  tax_line text,                                -- overrides the account's tax line for this line
  check (debit = 0 or credit = 0),
  check (debit + credit > 0)
);
create index if not exists ledger_lines_entry_idx on public.ledger_lines(entry_id);
create index if not exists ledger_lines_account_idx on public.ledger_lines(gl_account_id);
create index if not exists ledger_lines_project_idx on public.ledger_lines(project_id) where project_id is not null;

-- =====================================================================================
-- 3. Reconciliation
-- =====================================================================================
create table if not exists public.reconciliations (
  id uuid primary key default gen_random_uuid(),
  gl_account_id uuid not null references public.gl_accounts(id),
  statement_date date not null,
  statement_ending_balance numeric(14,2) not null,   -- as printed (cards and loans: amount owed, positive)
  status text not null default 'in_progress' check (status in ('in_progress','completed')),
  completed_at timestamptz,
  completed_by text,
  notes text,
  created_at timestamptz not null default now(),
  unique (gl_account_id, statement_date)
);
create table if not exists public.reconciliation_items (
  reconciliation_id uuid not null references public.reconciliations(id) on delete cascade,
  gl_account_id uuid not null references public.gl_accounts(id),
  source text not null default 'entry' check (source = 'entry'),
  source_id uuid not null,
  primary key (reconciliation_id, source, source_id),
  unique (gl_account_id, source, source_id)
);

-- =====================================================================================
-- 4. The general ledger
-- =====================================================================================
create or replace view public.v_gl with (security_invoker = true) as
select 'entry'::text as source, e.id as source_id, e.number as doc_number, e.entry_date as txn_date,
       e.entry_type, l.id as line_id, l.gl_account_id,
       a.name as account_name, a.number as account_number, a.account_type, a.classification,
       a.category_group, coalesce(nullif(l.tax_line, ''), a.tax_line) as tax_line,
       (l.debit - l.credit)::numeric as amount, l.debit, l.credit,
       l.project_id, p.name as project_name, p.is_business as project_is_business,
       e.payee_id as party_id, py.name as party_name, coalesce(l.description, e.memo) as memo
from public.ledger_entries e
join public.ledger_lines l on l.entry_id = e.id
join public.gl_accounts a on a.id = l.gl_account_id
left join public.projects p on p.id = l.project_id
left join public.payees py on py.id = e.payee_id
cross join public.book_settings s
where s.id = 1 and not e.is_void
  and (s.ledger_start_date is null or e.entry_date >= s.ledger_start_date);

-- Anything that would make the books wrong (should always be empty).
create or replace view public.v_ledger_exceptions with (security_invoker = true) as
select 'entry'::text as source, e.id as source_id, e.number as doc_number, e.entry_date as txn_date,
       sum(l.debit - l.credit) as out_of_balance, 0::bigint as unassigned_lines, 'Does not balance'::text as problem
from public.ledger_entries e join public.ledger_lines l on l.entry_id = e.id
where not e.is_void
group by e.id, e.number, e.entry_date
having sum(l.debit - l.credit) <> 0;

-- =====================================================================================
-- 5. Controls
-- =====================================================================================
create or replace function public.ledger_locks_apply() returns boolean
language sql stable as $$
  select current_user not in ('postgres', 'service_role', 'supabase_admin')
$$;

create or replace function public.is_reconciled(p_source text, p_id uuid) returns boolean
language sql stable as $$
  select exists (select 1 from public.reconciliation_items ri
                 join public.reconciliations r on r.id = ri.reconciliation_id
                 where ri.source = p_source and ri.source_id = p_id and r.status = 'completed')
$$;

create or replace function public.enforce_books_open() returns trigger
language plpgsql set search_path = public as $$
declare
  closed date; d_old date; d_new date; sid uuid; money_changed boolean := true;
begin
  if not public.ledger_locks_apply() then
    if TG_OP = 'DELETE' then return OLD; end if;
    return NEW;
  end if;
  select books_closed_through into closed from public.book_settings where id = 1;

  if TG_TABLE_NAME = 'ledger_entries' then
    if TG_OP <> 'INSERT' then d_old := OLD.entry_date; sid := OLD.id; end if;
    if TG_OP <> 'DELETE' then d_new := NEW.entry_date; end if;
    if TG_OP = 'UPDATE' then
      money_changed := (OLD.entry_date, OLD.is_void, OLD.total) is distinct from (NEW.entry_date, NEW.is_void, NEW.total);
    end if;
  else -- ledger_lines
    select e.entry_date, e.id into d_old, sid from public.ledger_entries e
      where e.id = case when TG_OP = 'DELETE' then OLD.entry_id else NEW.entry_id end;
    d_new := d_old;
    if TG_OP = 'UPDATE' then
      money_changed := (OLD.gl_account_id, OLD.debit, OLD.credit) is distinct from (NEW.gl_account_id, NEW.debit, NEW.credit);
    end if;
  end if;

  if closed is not null and (d_old <= closed or d_new <= closed) then
    raise exception 'The books are closed through %. Reopen the period in Settings > Books to change this.',
      to_char(closed, 'MM/DD/YYYY') using errcode = 'P0001';
  end if;
  if money_changed and sid is not null and public.is_reconciled('entry', sid) then
    raise exception 'This is in a completed reconciliation. Undo that reconciliation before changing the amount, date or account.'
      using errcode = 'P0001';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;

-- Account settings rewrite history, so they can't change while the books are closed.
create or replace function public.enforce_settings_open() returns trigger
language plpgsql set search_path = public as $$
begin
  if not public.ledger_locks_apply() then return NEW; end if;
  if OLD.books_closed_through is not null and NEW.books_closed_through is not null
     and (OLD.ledger_start_date, OLD.fiscal_year_start_month, OLD.net_worth_carried_gl_id)
         is distinct from (NEW.ledger_start_date, NEW.fiscal_year_start_month, NEW.net_worth_carried_gl_id) then
    raise exception 'Book settings are locked while the books are closed. Reopen the period to change them.'
      using errcode = 'P0001';
  end if;
  return NEW;
end $$;

-- Ledger entries balance; total = debits. Checked when the save finishes.
create or replace function public.check_entry_balanced() returns trigger
language plpgsql set search_path = public as $$
declare eid uuid; e public.ledger_entries; dr numeric; cr numeric; n int;
begin
  if TG_TABLE_NAME = 'ledger_entries' then
    if TG_OP = 'DELETE' then return null; end if;
    eid := NEW.id;
  else
    if TG_OP = 'DELETE' then eid := OLD.entry_id; else eid := NEW.entry_id; end if;
  end if;
  select * into e from public.ledger_entries where id = eid;
  if not found or e.is_void then return null; end if;
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into dr, cr, n
    from public.ledger_lines where entry_id = eid;
  if n < 2 then raise exception 'An entry needs at least two lines (it is % on %).', e.entry_type, e.entry_date; end if;
  if dr <> cr then
    raise exception 'Entry on % does not balance: debits % vs credits %.', to_char(e.entry_date, 'MM/DD/YYYY'), dr, cr;
  end if;
  if e.total <> dr then
    update public.ledger_entries set total = dr where id = eid;
  end if;
  return null;
end $$;

create or replace function public.reconciliation_item_guard() returns trigger
language plpgsql set search_path = public as $$
declare r public.reconciliations;
begin
  select * into r from public.reconciliations where id = coalesce(NEW.reconciliation_id, OLD.reconciliation_id);
  if r.status = 'completed' then
    raise exception 'This reconciliation is completed. Undo it before changing what is cleared.';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  NEW.gl_account_id := r.gl_account_id;
  return NEW;
end $$;

-- =====================================================================================
-- 6. Reports
-- =====================================================================================
create or replace function public.fiscal_year_start(d date) returns date
language sql stable set search_path = public as $$
  select make_date(extract(year from d)::int - case when extract(month from d) < s.m then 1 else 0 end, s.m, 1)
  from (select fiscal_year_start_month as m from public.book_settings where id = 1) s
$$;

create or replace function public.gl_account_sort(c text, t text) returns int
language sql immutable as $$
  select case c when 'Asset' then 1 when 'Liability' then 2 when 'Equity' then 3 else
         case t when 'Income' then 4 when 'Expense' then 5 when 'Other Income' then 6 else 7 end end
$$;

create or replace function public.pl_section(t text) returns text
language sql immutable as $$
  select case t when 'Income' then 'Income' when 'Expense' then 'Spending'
                when 'Other Income' then 'Other income' else 'Other spending' end
$$;

-- Income and spending for a period, by account (income positive, spending positive).
create or replace function public.report_profit_and_loss(p_from date, p_to date)
returns table (section text, category_group text, gl_account_id uuid, account_number text, account_name text, amount numeric)
language sql stable set search_path = public as $$
  select public.pl_section(g.account_type), coalesce(g.category_group, 'Other'), g.gl_account_id,
         g.account_number, g.account_name,
         sum(case when g.classification = 'Revenue' then -g.amount else g.amount end)
  from public.v_gl g
  where g.classification in ('Revenue','Expense') and g.txn_date between p_from and p_to
  group by g.account_type, g.classification, g.category_group, g.gl_account_id, g.account_number, g.account_name
  having sum(g.amount) <> 0
  order by public.gl_account_sort(g.classification, g.account_type), coalesce(g.category_group, 'Other'),
           g.account_number nulls last, g.account_name
$$;

-- The same, month by month.
create or replace function public.report_pl_by_month(p_from date, p_to date)
returns table (month date, section text, category_group text, gl_account_id uuid, account_number text,
               account_name text, amount numeric)
language sql stable set search_path = public as $$
  select date_trunc('month', g.txn_date)::date, public.pl_section(g.account_type), coalesce(g.category_group, 'Other'),
         g.gl_account_id, g.account_number, g.account_name,
         sum(case when g.classification = 'Revenue' then -g.amount else g.amount end)
  from public.v_gl g
  where g.classification in ('Revenue','Expense') and g.txn_date between p_from and p_to
  group by 1, g.account_type, g.classification, g.category_group, g.gl_account_id, g.account_number, g.account_name
  having sum(g.amount) <> 0
  order by 1, public.gl_account_sort(g.classification, g.account_type), 3, g.account_number nulls last, g.account_name
$$;

-- Profit and loss per project (no project = personal).
create or replace function public.report_pl_by_project(p_from date, p_to date)
returns table (project_id uuid, project_name text, is_business boolean, income numeric, spending numeric, net numeric)
language sql stable set search_path = public as $$
  select g.project_id, coalesce(g.project_name, 'Personal (no project)'), coalesce(g.project_is_business, false),
         coalesce(-sum(g.amount) filter (where g.classification = 'Revenue'), 0),
         coalesce(sum(g.amount) filter (where g.classification = 'Expense'), 0),
         -sum(g.amount)
  from public.v_gl g
  where g.classification in ('Revenue','Expense') and g.txn_date between p_from and p_to
  group by g.project_id, g.project_name, g.project_is_business
  order by g.project_id is null, g.project_name
$$;

-- One project's income and spending by account.
create or replace function public.report_project_detail(p_project uuid, p_from date, p_to date)
returns table (section text, category_group text, gl_account_id uuid, account_number text, account_name text, amount numeric)
language sql stable set search_path = public as $$
  select public.pl_section(g.account_type), coalesce(g.category_group, 'Other'), g.gl_account_id,
         g.account_number, g.account_name,
         sum(case when g.classification = 'Revenue' then -g.amount else g.amount end)
  from public.v_gl g
  where g.classification in ('Revenue','Expense') and g.txn_date between p_from and p_to
    and g.project_id is not distinct from p_project
  group by g.account_type, g.classification, g.category_group, g.gl_account_id, g.account_number, g.account_name
  having sum(g.amount) <> 0
  order by public.gl_account_sort(g.classification, g.account_type), 2, g.account_number nulls last, g.account_name
$$;

-- Balance of every balance-sheet account on a date. Natural sign: what you own and what you owe are positive.
create or replace function public.account_balances(p_as_of date)
returns table (gl_account_id uuid, account_number text, account_name text, account_type text,
               classification text, balance numeric)
language sql stable set search_path = public as $$
  select a.id, a.number, a.name, a.account_type, a.classification,
         coalesce((select sum(g.amount) from public.v_gl g where g.gl_account_id = a.id and g.txn_date <= p_as_of), 0)
           * case when a.classification = 'Asset' then 1 else -1 end
  from public.gl_accounts a
  where a.classification in ('Asset','Liability','Equity')
  order by public.gl_account_sort(a.classification, a.account_type), a.account_type, a.number nulls last, a.name
$$;

create or replace function public.report_trial_balance(p_as_of date)
returns table (gl_account_id uuid, account_number text, account_name text, account_type text, debit numeric, credit numeric)
language sql stable set search_path = public as $$
  with fy as (select public.fiscal_year_start(p_as_of) as s),
  bal as (
    select g.gl_account_id, g.account_name, g.account_type, g.classification, sum(g.amount) as amt
    from public.v_gl g, fy
    where g.txn_date <= p_as_of and (g.classification in ('Asset','Liability','Equity') or g.txn_date >= fy.s)
    group by 1,2,3,4
  ),
  prior as (
    select cs.net_worth_carried_gl_id, coalesce(re.name, 'Net worth carried forward'), 'Equity'::text, 'Equity'::text, sum(g.amount)
    from public.v_gl g cross join fy cross join public.book_settings cs
    left join public.gl_accounts re on re.id = cs.net_worth_carried_gl_id
    where cs.id = 1 and g.txn_date < fy.s and g.classification in ('Revenue','Expense')
    group by cs.net_worth_carried_gl_id, re.name
  ),
  combined as (
    select gl_account_id, account_name, account_type, classification, sum(amt) as amt
    from (select * from bal union all select * from prior) u(gl_account_id, account_name, account_type, classification, amt)
    group by 1,2,3,4
  )
  select c.gl_account_id, a.number, c.account_name, c.account_type, greatest(c.amt, 0), greatest(-c.amt, 0)
  from combined c left join public.gl_accounts a on a.id = c.gl_account_id
  where c.amt <> 0
  order by public.gl_account_sort(c.classification, c.account_type), a.number nulls last, c.account_name
$$;

-- Net worth statement: what you own, what you owe, and net worth (equity plus this year's and past years' net).
create or replace function public.report_balance_sheet(p_as_of date)
returns table (section text, account_type text, gl_account_id uuid, account_number text, account_name text, balance numeric)
language sql stable set search_path = public as $$
  with fy as (select public.fiscal_year_start(p_as_of) as s),
  bs as (
    select g.classification, g.account_type, g.gl_account_id, g.account_number, g.account_name, sum(g.amount) as amt
    from public.v_gl g where g.txn_date <= p_as_of and g.classification in ('Asset','Liability','Equity')
    group by 1,2,3,4,5
  ),
  pl as (
    select coalesce(sum(g.amount) filter (where g.txn_date < fy.s), 0) as prior_amt,
           coalesce(sum(g.amount) filter (where g.txn_date >= fy.s), 0) as current_amt
    from public.v_gl g, fy where g.txn_date <= p_as_of and g.classification in ('Revenue','Expense')
  )
  select * from (
    select case bs.classification when 'Asset' then 'What you own' when 'Liability' then 'What you owe' else 'Net worth' end,
           bs.account_type, bs.gl_account_id, bs.account_number, bs.account_name,
           case when bs.classification = 'Asset' then bs.amt else -bs.amt end
    from bs where bs.amt <> 0
    union all select 'Net worth', 'Equity', null, null, 'Saved in past years', -pl.prior_amt from pl where pl.prior_amt <> 0
    union all select 'Net worth', 'Equity', null, null, 'Saved this year', -pl.current_amt from pl where pl.current_amt <> 0
  ) r(section, account_type, gl_account_id, account_number, account_name, balance)
  order by case section when 'What you own' then 1 when 'What you owe' then 2 else 3 end,
           account_type, account_number nulls last, account_name
$$;

create or replace function public.report_general_ledger(p_from date, p_to date, p_account uuid default null)
returns table (gl_account_id uuid, account_number text, account_name text, txn_date date, source text, entry_type text,
               doc_number text, party_name text, project_name text, memo text, debit numeric, credit numeric,
               balance numeric, source_id uuid)
language sql stable set search_path = public as $$
  with fy as (select public.fiscal_year_start(p_from) as s),
  opening as (
    select g.gl_account_id, g.account_number, g.account_name, g.classification, g.account_type, sum(g.amount) as amt
    from public.v_gl g, fy
    where g.txn_date < p_from and (p_account is null or g.gl_account_id = p_account)
      and (g.classification in ('Asset','Liability','Equity') or g.txn_date >= fy.s)
    group by 1,2,3,4,5
  ),
  r as (
    select gl_account_id, account_number, account_name, classification, account_type, (p_from - 1) as txn_date,
           'Beginning balance'::text as source, null::text as entry_type, null::text as doc_number,
           null::text as party_name, null::text as project_name, null::text as memo, amt as amount, 0 as ord,
           null::uuid as source_id
    from opening where amt <> 0
    union all
    select g.gl_account_id, g.account_number, g.account_name, g.classification, g.account_type, g.txn_date,
           'Entry', g.entry_type, g.doc_number, g.party_name, g.project_name, g.memo, g.amount, 1, g.source_id
    from public.v_gl g
    where g.txn_date between p_from and p_to and (p_account is null or g.gl_account_id = p_account)
  )
  select gl_account_id, account_number, account_name, txn_date, source, entry_type, doc_number, party_name, project_name,
         memo, case when ord = 1 then greatest(amount, 0) end, case when ord = 1 then greatest(-amount, 0) end,
         sum(amount) over (partition by gl_account_id order by ord, txn_date, source_id, amount
                           rows between unbounded preceding and current row),
         source_id
  from r
  order by public.gl_account_sort(classification, account_type), account_number nulls last, account_name, ord, txn_date, source_id, amount
$$;

-- Spending by payee (who the money went to), for a period.
create or replace function public.report_by_payee(p_from date, p_to date)
returns table (payee_id uuid, payee_name text, spending numeric, income numeric, entries bigint)
language sql stable set search_path = public as $$
  select g.party_id, coalesce(g.party_name, 'No payee'),
         coalesce(sum(g.amount) filter (where g.classification = 'Expense'), 0),
         coalesce(-sum(g.amount) filter (where g.classification = 'Revenue'), 0),
         count(distinct g.source_id)
  from public.v_gl g
  where g.classification in ('Revenue','Expense') and g.txn_date between p_from and p_to
  group by g.party_id, g.party_name
  order by 3 desc
$$;

-- One payee's income and spending lines (not the bank or card side), newest first.
create or replace function public.report_payee_activity(p_payee uuid, p_from date, p_to date)
returns table (txn_date date, gl_account_id uuid, account_name text, project_name text, memo text,
               amount numeric, source_id uuid)
language sql stable set search_path = public as $$
  select g.txn_date, g.gl_account_id, g.account_name, g.project_name, g.memo,
         g.amount, g.source_id
  from public.v_gl g
  where g.party_id = p_payee and g.classification in ('Revenue','Expense') and g.txn_date between p_from and p_to
  order by g.txn_date desc, g.source_id
$$;

-- Tax summary: everything on a tax line, for the CPA. Income lines positive, deductions positive.
create or replace function public.report_tax_summary(p_from date, p_to date)
returns table (tax_line text, amount numeric, lines bigint)
language sql stable set search_path = public as $$
  select g.tax_line, sum(case when g.classification = 'Revenue' then -g.amount else g.amount end), count(*)
  from public.v_gl g
  where g.tax_line is not null and g.classification in ('Revenue','Expense') and g.txn_date between p_from and p_to
  group by g.tax_line
  order by g.tax_line
$$;

create or replace function public.report_tax_detail(p_from date, p_to date)
returns table (tax_line text, txn_date date, account_name text, party_name text, project_name text, memo text,
               amount numeric, source_id uuid)
language sql stable set search_path = public as $$
  select g.tax_line, g.txn_date, g.account_name, g.party_name, g.project_name, g.memo,
         case when g.classification = 'Revenue' then -g.amount else g.amount end, g.source_id
  from public.v_gl g
  where g.tax_line is not null and g.classification in ('Revenue','Expense') and g.txn_date between p_from and p_to
  order by g.tax_line, g.txn_date
$$;

-- Net worth at the end of each month.
create or replace function public.report_net_worth_series(p_from date, p_to date)
returns table (month_end date, cash numeric, invested numeric, other_assets numeric, cards numeric, loans numeric,
               assets numeric, liabilities numeric, net_worth numeric)
language sql stable set search_path = public as $$
  with months as (
    select (date_trunc('month', m) + interval '1 month - 1 day')::date as month_end
    from generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m
  ),
  t as (
    select m.month_end, g.account_type, g.classification, sum(g.amount) as amt
    from months m join public.v_gl g on g.txn_date <= least(m.month_end, p_to)
    where g.classification in ('Asset','Liability')
    group by 1,2,3
  )
  select m.month_end,
         coalesce(sum(t.amt) filter (where t.account_type = 'Bank'), 0),
         coalesce(sum(t.amt) filter (where t.account_type in ('Investment','Retirement')), 0),
         coalesce(sum(t.amt) filter (where t.account_type in ('Property','Vehicle','Other Asset')), 0),
         coalesce(-sum(t.amt) filter (where t.account_type = 'Credit Card'), 0),
         coalesce(-sum(t.amt) filter (where t.account_type in ('Loan','Mortgage','Other Liability')), 0),
         coalesce(sum(t.amt) filter (where t.classification = 'Asset'), 0),
         coalesce(-sum(t.amt) filter (where t.classification = 'Liability'), 0),
         coalesce(sum(t.amt), 0)
  from months m left join t on t.month_end = m.month_end
  group by m.month_end
  order by m.month_end
$$;

-- Reconciliation status (difference must be zero to complete).
create or replace view public.v_reconciliation_status with (security_invoker = true) as
with base as (
  select r.*, a.name as account_name, a.account_type, a.classification,
         coalesce((select r2.statement_ending_balance from public.reconciliations r2
                   where r2.gl_account_id = r.gl_account_id and r2.status = 'completed' and r2.statement_date < r.statement_date
                   order by r2.statement_date desc limit 1), 0) as beginning_balance,
         (case when a.classification = 'Asset' then 1 else -1 end) *
         coalesce((select sum(g.amount) from public.v_gl g
                   join public.reconciliation_items ri on ri.source = g.source and ri.source_id = g.source_id
                        and ri.reconciliation_id = r.id
                   where g.gl_account_id = r.gl_account_id), 0) as cleared_net
  from public.reconciliations r join public.gl_accounts a on a.id = r.gl_account_id
)
select *, statement_ending_balance - (beginning_balance + cleared_net) as difference from base;

-- Activity on balance-sheet accounts not yet cleared on a statement.
create or replace view public.v_uncleared with (security_invoker = true) as
select g.gl_account_id, g.account_name, g.source, g.source_id, g.txn_date, g.doc_number, g.party_name,
       min(g.memo) as memo, sum(g.amount) as amount
from public.v_gl g
where g.classification in ('Asset','Liability')
  and not exists (select 1 from public.reconciliation_items ri
                  where ri.source = g.source and ri.source_id = g.source_id and ri.gl_account_id = g.gl_account_id)
group by 1,2,3,4,5,6,7;

create or replace function public.complete_reconciliation_guard() returns trigger
language plpgsql set search_path = public as $$
declare diff numeric;
begin
  if NEW.status = 'completed' and OLD.status <> 'completed' then
    select difference into diff from public.v_reconciliation_status where id = NEW.id;
    if diff <> 0 then
      raise exception 'Off by %. The cleared items must match the statement before you can finish.', to_char(diff, 'FM$999,999,990.00');
    end if;
    NEW.completed_at := now();
    NEW.completed_by := public.current_actor();
  elsif NEW.status <> 'completed' then
    NEW.completed_at := null;
    NEW.completed_by := null;
  end if;
  return NEW;
end $$;

create or replace function public.prevent_completed_recon_delete() returns trigger
language plpgsql set search_path = public as $$
begin
  if OLD.status = 'completed' then raise exception 'Undo a completed reconciliation before deleting it.'; end if;
  return OLD;
end $$;

-- =====================================================================================
-- 7. Saving entries (header and lines in one call; balance checked at the end)
--    supabase.rpc('save_ledger_entry', { p_entry, p_lines })
-- =====================================================================================
create or replace function public.save_ledger_entry(p_entry jsonb, p_lines jsonb)
returns uuid
language plpgsql set search_path = public as $$
declare e public.ledger_entries; v_id uuid;
begin
  e := jsonb_populate_record(null::public.ledger_entries, p_entry);
  v_id := coalesce(e.id, gen_random_uuid());
  if exists (select 1 from public.ledger_entries where id = v_id) then
    update public.ledger_entries set entry_type = e.entry_type, entry_date = e.entry_date, number = e.number,
           payee_id = e.payee_id, memo = e.memo, updated_at = now()
     where id = v_id;
    delete from public.ledger_lines where entry_id = v_id;
  else
    insert into public.ledger_entries (id, entry_type, entry_date, number, payee_id, memo, external_ref, created_by)
    values (v_id, e.entry_type, e.entry_date, e.number, e.payee_id, e.memo, e.external_ref, public.current_actor());
  end if;
  insert into public.ledger_lines (entry_id, position, gl_account_id, debit, credit, description, project_id, tax_line)
  select v_id, coalesce(l.position, (row_number() over ())::int), l.gl_account_id,
         coalesce(l.debit, 0), coalesce(l.credit, 0), l.description, l.project_id, nullif(l.tax_line, '')
  from jsonb_populate_recordset(null::public.ledger_lines, p_lines) l
  where coalesce(l.debit, 0) + coalesce(l.credit, 0) > 0;
  update public.ledger_entries set total = (select coalesce(sum(debit), 0) from public.ledger_lines where entry_id = v_id)
   where id = v_id;
  return v_id;
end $$;

-- Find a payee by name, adding it when new. Returns null for a blank name.
create or replace function public.payee_for(p_name text) returns uuid
language plpgsql set search_path = public as $$
declare v uuid; n text := nullif(btrim(p_name), '');
begin
  if n is null then return null; end if;
  select id into v from public.payees where lower(name) = lower(n);
  if v is null then
    insert into public.payees (name) values (n) on conflict do nothing returning id into v;
    if v is null then select id into v from public.payees where lower(name) = lower(n); end if;
  end if;
  return v;
end $$;

-- What a valued account (investment, retirement, property, vehicle) is worth on a date: one valuation entry
-- per account per day moves the books to that value, against "Investment and asset value changes".
-- Re-running for the same day replaces that day's valuation. Returns the change posted.
create or replace function public.post_valuation(p_account uuid, p_date date, p_value numeric, p_memo text default null)
returns numeric language plpgsql set search_path = public as $$
declare
  a public.gl_accounts; v_ref text; v_old uuid; v_books numeric; v_diff numeric; v_gain uuid; v_id uuid;
begin
  select * into a from public.gl_accounts where id = p_account;
  if a.id is null then raise exception 'That account is gone.'; end if;
  if a.classification not in ('Asset','Liability') then raise exception 'Only what you own or owe has a value.'; end if;
  select value_change_gl_id into v_gain from public.book_settings where id = 1;
  if v_gain is null then raise exception 'Pick the value changes account in Settings > Books first.'; end if;
  v_ref := 'value:' || p_account || ':' || p_date;
  select id into v_old from public.ledger_entries where external_ref = v_ref;
  if v_old is not null then delete from public.ledger_entries where id = v_old; end if;
  select coalesce(sum(g.amount), 0) * case when a.classification = 'Asset' then 1 else -1 end into v_books
    from public.v_gl g where g.gl_account_id = p_account and g.txn_date <= p_date;
  v_diff := round(p_value - v_books, 2);
  if v_diff = 0 then return 0; end if;
  -- An asset going up is a debit; a debt going up is a credit.
  if a.classification = 'Liability' then v_diff := -v_diff; end if;
  insert into public.ledger_entries (entry_type, entry_date, memo, external_ref, created_by)
  values ('valuation', p_date, coalesce(nullif(p_memo, ''), 'Value of ' || a.name || ' updated to ' || to_char(p_value, 'FM$999,999,990.00')),
          v_ref, public.current_actor())
  returning id into v_id;
  insert into public.ledger_lines (entry_id, position, gl_account_id, debit, credit, description) values
    (v_id, 1, p_account, greatest(v_diff, 0), greatest(-v_diff, 0), 'Value update'),
    (v_id, 2, v_gain, greatest(-v_diff, 0), greatest(v_diff, 0), a.name);
  return case when a.classification = 'Liability' then -v_diff else v_diff end;
end $$;

-- =====================================================================================
-- 8. Triggers
-- =====================================================================================
do $$
declare t text;
begin
  foreach t in array array['ledger_entries','ledger_lines'] loop
    execute format('drop trigger if exists %I_books_open on public.%I', t, t);
    execute format('create trigger %I_books_open before insert or update or delete on public.%I for each row execute function public.enforce_books_open()', t, t);
  end loop;
  drop trigger if exists book_settings_open on public.book_settings;
  create trigger book_settings_open before update on public.book_settings for each row execute function public.enforce_settings_open();

  drop trigger if exists ledger_entries_balanced on public.ledger_entries;
  create constraint trigger ledger_entries_balanced after insert or update on public.ledger_entries
    deferrable initially deferred for each row execute function public.check_entry_balanced();
  drop trigger if exists ledger_lines_balanced on public.ledger_lines;
  create constraint trigger ledger_lines_balanced after insert or update or delete on public.ledger_lines
    deferrable initially deferred for each row execute function public.check_entry_balanced();

  drop trigger if exists recon_items_guard on public.reconciliation_items;
  create trigger recon_items_guard before insert or update or delete on public.reconciliation_items
    for each row execute function public.reconciliation_item_guard();
  drop trigger if exists recon_complete_guard on public.reconciliations;
  create trigger recon_complete_guard before update on public.reconciliations
    for each row execute function public.complete_reconciliation_guard();
  drop trigger if exists recon_no_delete on public.reconciliations;
  create trigger recon_no_delete before delete on public.reconciliations
    for each row execute function public.prevent_completed_recon_delete();

  drop trigger if exists gl_accounts_touch on public.gl_accounts;
  create trigger gl_accounts_touch before update on public.gl_accounts for each row execute function public.touch_updated_at();
end $$;

select 'ok' as ledger;
