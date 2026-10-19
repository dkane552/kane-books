-- Kane Books: the whole database setup in one file, for the Supabase SQL editor.
-- Built from supabase/1_base.sql to 5_security.sql (run scripts/build-setup-sql.sh after changing them).
-- Safe to run more than once.

-- ===================================================================================== 1_base.sql
-- Kane Books: who can sign in, settings, payees, projects and the audit log.
-- Run first, in the Supabase SQL editor (or as a migration). Safe to re-run.
--
-- One person's books. Access is limited to the emails in app_users: every table's policy is
-- `using ((select public.is_team()))` (the select wrapper makes Postgres check it once per query,
-- not once per row, which keeps the reports fast).

create extension if not exists pgcrypto;

-- =====================================================================================
-- Who can sign in
-- =====================================================================================
create table if not exists public.app_users (
  email text primary key check (email = lower(email)),
  full_name text not null,
  initials text,
  created_at timestamptz not null default now()
);
insert into public.app_users (email, full_name, initials)
values ('derekkane552@gmail.com', 'Derek Kane', 'DK')
on conflict (email) do nothing;

-- True only for a login whose email is on the list and confirmed in Supabase, and, once that login has an
-- authenticator app, only for a session that entered its code (aal2). A stolen password alone opens nothing.
create or replace function public.is_team()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from auth.users u
    join public.app_users a on lower(a.email) = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and lower(u.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
           or not exists (select 1 from auth.mfa_factors f
                          where f.user_id = u.id and f.status = 'verified'))
  );
$$;

-- The signed-in login's email.
create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(u.email) from auth.users u where u.id = auth.uid()
$$;

-- Called every 3 days by the GitHub workflow so the free project never pauses.
create or replace function public.keepalive() returns int language sql as $$ select 1 $$;

-- =====================================================================================
-- Settings (one row)
-- =====================================================================================
create table if not exists public.book_settings (
  id int primary key default 1 check (id = 1),
  owner_name text not null default 'Derek Kane',
  ledger_start_date date,
  books_closed_through date,
  bank_feed_start_date date,
  fiscal_year_start_month int not null default 1 check (fiscal_year_start_month between 1 and 12),
  -- Accounts the books need to know about (filled once the chart exists, 2_ledger.sql).
  default_cash_gl_id uuid,
  net_worth_carried_gl_id uuid,
  opening_equity_gl_id uuid,
  value_change_gl_id uuid,
  uncategorized_expense_gl_id uuid,
  uncategorized_income_gl_id uuid,
  updated_at timestamptz not null default now()
);
insert into public.book_settings (id) values (1) on conflict (id) do nothing;

-- Each login's own display and accessibility settings (Settings > Accessibility).
create table if not exists public.user_settings (
  email text primary key check (email = lower(email)),
  display jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- =====================================================================================
-- Payees (who money went to or came from) and projects (side ventures and anything else
-- worth its own profit and loss)
-- =====================================================================================
create table if not exists public.payees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists payees_name_key on public.payees(lower(name));

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  -- A business (a Schedule C for the tax pack) or a personal project (a trip, a wedding, a renovation).
  is_business boolean not null default false,
  color text,
  is_active boolean not null default true,
  started_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists projects_name_key on public.projects(lower(name));

-- =====================================================================================
-- Audit log: every change to the books, from anyone. Nobody can edit it.
-- =====================================================================================
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  table_name text not null,
  op text not null,
  row_id text,
  old_row jsonb,
  new_row jsonb
);
create index if not exists audit_log_row_idx on public.audit_log(table_name, row_id);
create index if not exists audit_log_at_idx on public.audit_log(at desc);

create or replace function public.current_actor() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', session_user::text)
$$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if TG_OP = 'DELETE' then r := to_jsonb(OLD); else r := to_jsonb(NEW); end if;
  insert into public.audit_log (actor, table_name, op, row_id, old_row, new_row)
  values (public.current_actor(), TG_TABLE_NAME, TG_OP,
          coalesce(r ->> 'id', r ->> 'source_id', r ->> 'entry_id', ''),
          case when TG_OP <> 'INSERT' then to_jsonb(OLD) end,
          case when TG_OP <> 'DELETE' then to_jsonb(NEW) end);
  return null;
end $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin
  NEW.updated_at := now();
  return NEW;
end $$;

drop trigger if exists user_settings_touch on public.user_settings;
create trigger user_settings_touch before insert or update on public.user_settings
  for each row execute function public.touch_updated_at();
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();

-- Nightly backup runs (Settings > Backups).
create table if not exists public.backup_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  tables int not null default 0,
  rows int not null default 0,
  files int not null default 0
);

select 'ok' as base;

-- ===================================================================================== 2_ledger.sql
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

-- ===================================================================================== 3_bank_feed.sql
-- Kane Books: bank and card transactions from Era, plus CSV statement uploads. Run after 2_ledger.sql.
-- Safe to re-run.
--
-- How it works:
--   * The Edge Function `era` pulls posted transactions for the linked accounts (bank_feed_accounts) from the
--     Era API into bank_transactions, refreshes balances, then calls bank_autoprocess().
--   * When Era drops a bank, a CSV export from the bank's website goes in through bank_import_statement().
--     Uploaded rows and Era rows never double up (same account and amount within 3 days, one for one).
--   * bank_autoprocess() matches each new transaction to what is already in the books (same account, same
--     amount, within 5 days; a transfer entered from one side matches the other side this way), then applies
--     the first rule whose text it contains: a suggestion, or added without asking when the rule says so.
--   * bank_accept() adds a transaction to the books as one entry (split lines allowed, each with a category,
--     project and description). Lines to another bank, card, loan or investment account make it a transfer.
--   * bank_match() links to an existing entry, bank_exclude() skips it (duplicates, things that are not
--     yours), bank_undo() puts it back in For review and removes what the feed added.
--   * Investment and retirement accounts can be linked "balance only": only the balance is read, and
--     auto_value posts a valuation so net worth follows the market.
--   * Amounts are signed the way they post to the account: money in is positive, money out negative, for bank
--     and card accounts alike (a card charge is negative, a card payment positive).

create table if not exists public.bank_feed_accounts (
  id uuid primary key default gen_random_uuid(),
  era_account_key text not null unique,
  name text not null,
  institution text,
  mask text,
  account_type text,
  gl_account_id uuid references public.gl_accounts(id),
  is_active boolean not null default true,
  balance_only boolean not null default false,
  auto_value boolean not null default false,
  balance numeric(14,2),
  balance_as_of timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_feed_state (
  id int primary key default 1 check (id = 1),
  sync_started_at timestamptz,
  last_sync_at timestamptz,
  last_status text,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.bank_feed_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  era_id text not null unique,
  feed_account_id uuid not null references public.bank_feed_accounts(id) on delete cascade,
  txn_date date not null,
  amount numeric(14,2) not null check (amount <> 0),
  description text,
  original_description text,
  merchant text,
  era_category text,
  transfer_era_id text,
  status text not null default 'new' check (status in ('new','matched','added','excluded')),
  suggestion jsonb,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bank_transactions_status_idx on public.bank_transactions(status, txn_date);
create index if not exists bank_transactions_account_idx on public.bank_transactions(feed_account_id, txn_date);

-- What a bank transaction is in the books. created = made from the feed (undo deletes it); otherwise matched.
-- An entry matches at most one bank transaction per account (a transfer matches one on each side).
create table if not exists public.bank_transaction_links (
  bank_transaction_id uuid not null references public.bank_transactions(id) on delete cascade,
  source text not null default 'entry' check (source = 'entry'),
  source_id uuid not null,
  gl_account_id uuid,
  created boolean not null default false,
  primary key (bank_transaction_id, source, source_id),
  unique (source, source_id, gl_account_id)
);

create or replace function public.bank_link_account() returns trigger
language plpgsql set search_path = public as $$
begin
  select f.gl_account_id into NEW.gl_account_id from public.bank_transactions b
  join public.bank_feed_accounts f on f.id = b.feed_account_id where b.id = NEW.bank_transaction_id;
  return NEW;
end $$;
drop trigger if exists bank_link_account on public.bank_transaction_links;
create trigger bank_link_account before insert on public.bank_transaction_links
  for each row execute function public.bank_link_account();

create table if not exists public.bank_rules (
  id uuid primary key default gen_random_uuid(),
  contains text not null check (length(trim(contains)) >= 2),
  feed_account_id uuid references public.bank_feed_accounts(id) on delete cascade,
  direction text check (direction in ('in','out')),
  gl_account_id uuid not null references public.gl_accounts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  payee_id uuid references public.payees(id) on delete set null,
  memo text,
  auto_add boolean not null default false,
  position int not null default 0,
  is_active boolean not null default true,
  times_used int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------------------------------
-- Era's sync (server only). An Era transaction that already came in by upload takes over that row.
-- Rows already reviewed (or linked) are left alone.
create or replace function public.bank_upsert_transactions(p_feed_account uuid, p_rows jsonb)
returns int language plpgsql set search_path = public as $$
declare
  x record; v_match uuid; v_n int;
begin
  for x in
    select e->>'era_id' as era_id, (e->>'txn_date')::date as txn_date, (e->>'amount')::numeric as amount
    from jsonb_array_elements(p_rows) e
    where (e->>'amount')::numeric <> 0
      and not exists (select 1 from public.bank_transactions b where b.era_id = e->>'era_id')
    order by 2
  loop
    select b.id into v_match
    from public.bank_transactions b
    where b.feed_account_id = p_feed_account and b.era_id like 'csv:%' and b.amount = x.amount
      and abs(b.txn_date - x.txn_date) <= 3
    order by abs(b.txn_date - x.txn_date), b.txn_date
    limit 1;
    if v_match is not null then
      update public.bank_transactions set era_id = x.era_id, updated_at = now() where id = v_match;
    end if;
  end loop;

  with r as (
    select e->>'era_id' as era_id, (e->>'txn_date')::date as txn_date, (e->>'amount')::numeric as amount,
           e->>'description' as description, e->>'original_description' as original_description,
           e->>'merchant' as merchant, e->>'era_category' as era_category, e->>'transfer_era_id' as transfer_era_id
    from jsonb_array_elements(p_rows) e
    where (e->>'amount')::numeric <> 0
  ), up as (
    insert into public.bank_transactions as b (era_id, feed_account_id, txn_date, amount, description,
      original_description, merchant, era_category, transfer_era_id)
    select era_id, p_feed_account, txn_date, amount, description, original_description, merchant, era_category,
           transfer_era_id
    from r
    on conflict (era_id) do update set txn_date = excluded.txn_date, amount = excluded.amount,
      description = excluded.description, original_description = excluded.original_description,
      merchant = excluded.merchant, era_category = excluded.era_category,
      transfer_era_id = excluded.transfer_era_id, updated_at = now()
    where b.status = 'new' and not exists (select 1 from public.bank_transaction_links l where l.bank_transaction_id = b.id)
      and (b.txn_date, b.amount, b.description, b.original_description, b.merchant, b.era_category, b.transfer_era_id)
          is distinct from (excluded.txn_date, excluded.amount, excluded.description, excluded.original_description,
                            excluded.merchant, excluded.era_category, excluded.transfer_era_id)
    returning 1
  )
  select count(*)::int into v_n from up;
  return v_n;
end $$;

-- A CSV statement from the bank's website. Rows get an id from their account, date, amount, description and
-- how many identical rows came before them in the file, so uploading the same statement twice adds nothing.
create or replace function public.bank_import_statement(p_feed_account uuid, p_rows jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  r record; v_id text; v_match uuid; v_claimed uuid[] := '{}'; v_new int := 0; v_dup int := 0; v_auto jsonb;
begin
  if not exists (select 1 from public.bank_feed_accounts where id = p_feed_account) then
    raise exception 'Pick an account for this statement';
  end if;
  for r in
    select x.d, x.a, x.descr,
           row_number() over (partition by x.d, x.a, lower(coalesce(x.descr, '')) order by x.ord) as n
    from (
      select (e->>'txn_date')::date as d, round((e->>'amount')::numeric, 2) as a,
             nullif(btrim(e->>'description'), '') as descr, ord
      from jsonb_array_elements(p_rows) with ordinality as t(e, ord)
    ) x
    where x.a is not null and x.a <> 0 and x.d is not null
    order by x.d, x.a
  loop
    v_id := 'csv:' || md5(p_feed_account::text || '|' || r.d || '|' || r.a || '|' || lower(coalesce(r.descr, ''))
                          || '|' || r.n);
    if exists (select 1 from public.bank_transactions where era_id = v_id) then
      v_dup := v_dup + 1;
      continue;
    end if;
    select b.id into v_match
    from public.bank_transactions b
    where b.feed_account_id = p_feed_account and b.era_id not like 'csv:%' and b.amount = r.a
      and abs(b.txn_date - r.d) <= 3 and b.id <> all (v_claimed)
    order by abs(b.txn_date - r.d), b.txn_date
    limit 1;
    if v_match is not null then
      v_claimed := v_claimed || v_match;
      v_dup := v_dup + 1;
      continue;
    end if;
    insert into public.bank_transactions (era_id, feed_account_id, txn_date, amount, description, original_description)
    values (v_id, p_feed_account, r.d, r.a, r.descr, r.descr);
    v_new := v_new + 1;
  end loop;

  update public.bank_feed_accounts set last_synced_at = now(), updated_at = now() where id = p_feed_account;
  v_auto := case when v_new > 0 then public.bank_autoprocess() else '{}'::jsonb end;
  return jsonb_build_object('added', v_new, 'already_in', v_dup, 'auto', v_auto);
end $$;

-- Entries on the transaction's account that could be this bank transaction.
create or replace function public.bank_candidates(p_txn uuid, p_days int default 10)
returns table (kind text, source text, source_id uuid, txn_date date, label text, amount numeric, days int)
language sql stable set search_path = public as $$
  with t as (
    select b.*, f.gl_account_id from public.bank_transactions b
    join public.bank_feed_accounts f on f.id = b.feed_account_id where b.id = p_txn
  ),
  post as (
    select g.source, g.source_id, min(g.txn_date) as txn_date, sum(g.amount) as amount,
           concat_ws(' · ', max(g.party_name), max(g.doc_number), max(g.memo)) as label
    from public.v_gl g, t
    where g.gl_account_id = t.gl_account_id
      and g.txn_date between t.txn_date - p_days and t.txn_date + p_days
    group by g.source, g.source_id
  )
  select 'posting', p.source, p.source_id, p.txn_date, p.label, p.amount, abs(p.txn_date - t.txn_date)
  from post p, t
  where p.amount = t.amount
    and not exists (select 1 from public.bank_transaction_links l
                    where l.source = p.source and l.source_id = p.source_id and l.gl_account_id = t.gl_account_id)
  order by 7, 4
$$;

create or replace function public.bank_link_total(p_txn uuid) returns numeric
language sql stable set search_path = public as $$
  select coalesce(sum(g.amount), 0)
  from public.bank_transaction_links l
  join public.bank_transactions b on b.id = l.bank_transaction_id
  join public.bank_feed_accounts f on f.id = b.feed_account_id
  join public.v_gl g on g.source = l.source and g.source_id = l.source_id and g.gl_account_id = f.gl_account_id
  where l.bank_transaction_id = p_txn
$$;

create or replace function public.bank_match(p_txn uuid, p_source text, p_source_id uuid)
returns void language plpgsql set search_path = public as $$
declare b public.bank_transactions;
begin
  select * into b from public.bank_transactions where id = p_txn for update;
  if b.status in ('added','excluded') then raise exception 'Undo this transaction first.'; end if;
  insert into public.bank_transaction_links (bank_transaction_id, source, source_id) values (p_txn, 'entry', p_source_id);
  update public.bank_transactions set
    status = case when public.bank_link_total(p_txn) = amount then 'matched' else 'new' end,
    reviewed_by = public.current_actor(), reviewed_at = now(), updated_at = now()
  where id = p_txn;
end $$;

-- Add a transaction to the books.
-- p_lines: [{amount (positive), gl_account_id, project_id, description, tax_line}]; amounts add up to the
-- transaction. p_payee: a payee id; p_payee_name: or a name (a new name adds the payee).
create or replace function public.bank_accept(p_txn uuid, p_payee uuid, p_memo text, p_lines jsonb,
                                              p_rule jsonb default null, p_payee_name text default null)
returns uuid language plpgsql set search_path = public as $$
declare
  b public.bank_transactions; f public.bank_feed_accounts; acct public.gl_accounts;
  v_out boolean; v_total numeric; v_entry uuid; v_name text; v_payee uuid; v_all_money boolean; v_first jsonb;
begin
  select * into b from public.bank_transactions where id = p_txn for update;
  if not found then raise exception 'That bank transaction is gone. Refresh the feed.'; end if;
  if b.status <> 'new' or exists (select 1 from public.bank_transaction_links where bank_transaction_id = p_txn) then
    raise exception 'This transaction is already handled. Undo it first.';
  end if;
  select * into f from public.bank_feed_accounts where id = b.feed_account_id;
  select * into acct from public.gl_accounts where id = f.gl_account_id;
  if acct.id is null then raise exception 'Link % to an account first.', f.name; end if;
  v_out := b.amount < 0;
  v_name := coalesce(nullif(trim(p_memo), ''), b.merchant, b.description, 'Bank transaction');
  v_payee := coalesce(p_payee, public.payee_for(p_payee_name));

  create temp table if not exists _bank_lines (n int, amount numeric, gl_account_id uuid, project_id uuid,
    description text, tax_line text) on commit drop;
  delete from _bank_lines;
  insert into _bank_lines
  select n::int, round((x->>'amount')::numeric, 2), nullif(x->>'gl_account_id', '')::uuid,
         nullif(x->>'project_id', '')::uuid, nullif(trim(x->>'description'), ''), nullif(trim(x->>'tax_line'), '')
  from jsonb_array_elements(p_lines) with ordinality as t(x, n);
  delete from _bank_lines where coalesce(amount, 0) = 0;

  select coalesce(sum(amount), 0) into v_total from _bank_lines;
  if v_total <> abs(b.amount) then
    raise exception 'The lines add up to %, but the bank shows %.', to_char(v_total, 'FM999,999,990.00'),
      to_char(abs(b.amount), 'FM999,999,990.00');
  end if;
  if exists (select 1 from _bank_lines where amount < 0) then raise exception 'Enter line amounts as positive numbers.'; end if;
  if exists (select 1 from _bank_lines where gl_account_id is null) then raise exception 'Every line needs a category.'; end if;
  if exists (select 1 from _bank_lines where gl_account_id = f.gl_account_id) then
    raise exception 'A line can''t go back to the account it came from.';
  end if;

  select bool_and(a.classification in ('Asset','Liability','Equity')) into v_all_money
  from _bank_lines l join public.gl_accounts a on a.id = l.gl_account_id;
  insert into public.ledger_entries (entry_type, entry_date, payee_id, memo, total, external_ref, created_by)
  values (case when v_all_money then 'transfer' when v_out then 'expense' else 'deposit' end, b.txn_date, v_payee,
          v_name, v_total, 'era:' || b.era_id, public.current_actor())
  returning id into v_entry;
  insert into public.ledger_lines (entry_id, position, gl_account_id, debit, credit, description, project_id, tax_line)
  select v_entry, n, gl_account_id, case when v_out then amount else 0 end, case when v_out then 0 else amount end,
         coalesce(description, v_name), project_id, tax_line
  from _bank_lines;
  insert into public.ledger_lines (entry_id, position, gl_account_id, debit, credit, description)
  values (v_entry, 1000, f.gl_account_id, case when v_out then 0 else v_total end, case when v_out then v_total else 0 end,
          coalesce(b.original_description, v_name));
  insert into public.bank_transaction_links (bank_transaction_id, source, source_id, created) values (p_txn, 'entry', v_entry, true);

  update public.bank_transactions set status = 'added', reviewed_by = public.current_actor(), reviewed_at = now(),
    updated_at = now() where id = p_txn;

  -- "Next time": save a rule from the (first) line.
  if p_rule is not null and coalesce(trim(p_rule->>'contains'), '') <> '' then
    v_first := p_lines->0;
    insert into public.bank_rules (contains, direction, gl_account_id, project_id, payee_id, memo, auto_add)
    values (trim(p_rule->>'contains'), case when v_out then 'out' else 'in' end,
            nullif(v_first->>'gl_account_id', '')::uuid, nullif(v_first->>'project_id', '')::uuid,
            v_payee, nullif(trim(p_memo), ''), coalesce((p_rule->>'auto_add')::boolean, false));
  end if;
  return v_entry;
end $$;

create or replace function public.bank_exclude(p_txn uuid)
returns void language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.bank_transaction_links where bank_transaction_id = p_txn) then
    raise exception 'Undo this transaction first.';
  end if;
  update public.bank_transactions set status = 'excluded', reviewed_by = public.current_actor(), reviewed_at = now(),
    updated_at = now() where id = p_txn;
end $$;

-- Put a transaction back in For review: deletes what the feed created, unlinks matches.
create or replace function public.bank_undo(p_txn uuid)
returns void language plpgsql set search_path = public as $$
declare l record;
begin
  perform 1 from public.bank_transactions where id = p_txn for update;
  for l in select * from public.bank_transaction_links where bank_transaction_id = p_txn and created loop
    delete from public.ledger_entries where id = l.source_id;
  end loop;
  delete from public.bank_transaction_links where bank_transaction_id = p_txn;
  update public.bank_transactions set status = 'new', suggestion = null, reviewed_by = public.current_actor(),
    reviewed_at = now(), updated_at = now() where id = p_txn;
end $$;

create or replace function public.bank_rule_for(p_txn uuid) returns public.bank_rules
language sql stable set search_path = public as $$
  select r.* from public.bank_rules r, public.bank_transactions b
  where b.id = p_txn and r.is_active
    and (r.feed_account_id is null or r.feed_account_id = b.feed_account_id)
    and (r.direction is null or r.direction = case when b.amount < 0 then 'out' else 'in' end)
    and upper(concat_ws(' ', b.original_description, b.description, b.merchant)) like '%' || upper(trim(r.contains)) || '%'
  order by r.position, r.created_at
  limit 1
$$;

-- Match new transactions to the books, then apply rules. Returns counts.
create or replace function public.bank_autoprocess()
returns jsonb language plpgsql set search_path = public as $$
declare
  b record; c record; n int; v_matched int := 0; v_added int := 0; v_suggested int := 0;
  r public.bank_rules; v_sugg jsonb;
begin
  for b in
    select t.*, f.gl_account_id from public.bank_transactions t
    join public.bank_feed_accounts f on f.id = t.feed_account_id
    where t.status = 'new' and f.gl_account_id is not null
      and not exists (select 1 from public.bank_transaction_links l where l.bank_transaction_id = t.id)
    order by t.txn_date, t.amount, t.era_id
  loop
    -- 1. Exactly one entry on this account with the same amount within 5 days.
    select count(*) into n from public.bank_candidates(b.id, 5);
    if n = 1 then
      select * into c from public.bank_candidates(b.id, 5);
      insert into public.bank_transaction_links (bank_transaction_id, source, source_id) values (b.id, 'entry', c.source_id);
      update public.bank_transactions set status = 'matched', updated_at = now() where id = b.id;
      v_matched := v_matched + 1;
      continue;
    end if;
    -- 2. Rules.
    r := public.bank_rule_for(b.id);
    if r.id is null then continue; end if;
    v_sugg := jsonb_build_object('rule_id', r.id, 'gl_account_id', r.gl_account_id, 'project_id', r.project_id,
                                 'payee_id', r.payee_id, 'memo', r.memo);
    update public.bank_transactions set suggestion = v_sugg, updated_at = now()
    where id = b.id and suggestion is distinct from v_sugg;
    v_suggested := v_suggested + 1;
    if r.auto_add then
      perform public.bank_accept(b.id, r.payee_id, r.memo, jsonb_build_array(jsonb_build_object(
        'amount', abs(b.amount), 'gl_account_id', r.gl_account_id, 'project_id', r.project_id)));
      update public.bank_rules set times_used = times_used + 1 where id = r.id;
      v_added := v_added + 1;
    end if;
  end loop;
  return jsonb_build_object('matched', v_matched, 'added_by_rules', v_added, 'suggested', v_suggested);
end $$;

-- After a sync: accounts linked with auto_value get today's value from Era (sum of their feeds' balances).
create or replace function public.feed_auto_valuations()
returns int language plpgsql set search_path = public as $$
declare x record; n int := 0;
begin
  for x in
    select f.gl_account_id, sum(f.balance) as bal
    from public.bank_feed_accounts f join public.gl_accounts a on a.id = f.gl_account_id
    where f.is_active and f.auto_value and f.balance is not null and a.is_valued
    group by f.gl_account_id
  loop
    if public.post_valuation(x.gl_account_id, current_date, x.bal, null) <> 0 then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Accounts with the bank's balance next to the books (natural sign: owed on a card is positive).
create or replace view public.v_bank_feed_accounts with (security_invoker = true) as
select f.*, g.name as gl_account_name, g.number as gl_account_number, g.account_type as gl_account_type,
       g.classification as gl_classification,
       (select coalesce(sum(v.amount), 0) from public.v_gl v where v.gl_account_id = f.gl_account_id and v.txn_date <= current_date)
         * case when g.classification = 'Asset' then 1 else -1 end as books_balance,
       (select count(*) from public.bank_transactions t where t.feed_account_id = f.id and t.status = 'new') as for_review
from public.bank_feed_accounts f
left join public.gl_accounts g on g.id = f.gl_account_id;

create or replace view public.v_bank_transactions with (security_invoker = true) as
select t.*, f.name as account_name, f.mask as account_mask, f.gl_account_id,
       (select jsonb_agg(jsonb_build_object('source', l.source, 'source_id', l.source_id, 'created', l.created))
        from public.bank_transaction_links l where l.bank_transaction_id = t.id) as links
from public.bank_transactions t
join public.bank_feed_accounts f on f.id = t.feed_account_id;

drop trigger if exists bank_feed_accounts_touch on public.bank_feed_accounts;
create trigger bank_feed_accounts_touch before update on public.bank_feed_accounts
  for each row execute function public.touch_updated_at();

select 'ok' as bank_feed;

-- ===================================================================================== 4_personal.sql
-- Kane Books: budgets, recurring bills and income, and the home screen. Run after 3_bank_feed.sql.
-- Safe to re-run.

-- =====================================================================================
-- 1. Budgets
-- =====================================================================================
-- A monthly budget per category. month null is the usual amount for every month; a row with a month
-- (the first of that month) replaces it for that month only.
create table if not exists public.budget_amounts (
  id uuid primary key default gen_random_uuid(),
  gl_account_id uuid not null references public.gl_accounts(id) on delete cascade,
  month date check (month is null or extract(day from month) = 1),
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (gl_account_id, month)
);

-- Budget against actual for one month, every income and spending category that has a budget or activity.
-- Amounts are positive both ways (income received, money spent). avg_3mo is the average of the three
-- months before this one.
create or replace function public.report_budget(p_month date)
returns table (section text, category_group text, gl_account_id uuid, account_number text, account_name text,
               budget numeric, budget_is_override boolean, actual numeric, remaining numeric, avg_3mo numeric)
language sql stable set search_path = public as $$
  with m as (select date_trunc('month', p_month)::date as s,
                    (date_trunc('month', p_month) + interval '1 month - 1 day')::date as e,
                    (date_trunc('month', p_month) - interval '3 months')::date as p),
  act as (
    select g.gl_account_id,
           sum(case when g.classification = 'Revenue' then -g.amount else g.amount end) filter (where g.txn_date >= m.s) as cur,
           sum(case when g.classification = 'Revenue' then -g.amount else g.amount end) filter (where g.txn_date < m.s) / 3 as prior
    from public.v_gl g, m
    where g.classification in ('Revenue','Expense') and g.txn_date between m.p and m.e
    group by g.gl_account_id
  ),
  bud as (
    select a.id as gl_account_id,
           coalesce(o.amount, d.amount) as amount, o.amount is not null as is_override
    from public.gl_accounts a cross join m
    left join lateral (select amount from public.budget_amounts x where x.gl_account_id = a.id and x.month is null) d on true
    left join lateral (select amount from public.budget_amounts x where x.gl_account_id = a.id and x.month = m.s) o on true
    where a.account_type in ('Income','Expense')
  )
  select public.pl_section(a.account_type), coalesce(a.category_group, 'Other'), a.id, a.number, a.name,
         coalesce(b.amount, 0), coalesce(b.is_override, false), coalesce(x.cur, 0),
         coalesce(b.amount, 0) - coalesce(x.cur, 0), round(coalesce(x.prior, 0), 2)
  from public.gl_accounts a
  left join bud b on b.gl_account_id = a.id
  left join act x on x.gl_account_id = a.id
  where a.account_type in ('Income','Expense')
    and (a.is_active or coalesce(x.cur, 0) <> 0)
    and (coalesce(b.amount, 0) > 0 or coalesce(x.cur, 0) <> 0 or coalesce(x.prior, 0) <> 0)
  order by public.gl_account_sort(a.classification, a.account_type), 2, a.number nulls last, a.name
$$;

-- Budget against actual for every month of a year.
create or replace function public.report_budget_year(p_year int)
returns table (month date, gl_account_id uuid, budget numeric, actual numeric)
language sql stable set search_path = public as $$
  with months as (
    select generate_series(make_date(p_year, 1, 1), make_date(p_year, 12, 1), interval '1 month')::date as m
  ),
  accts as (select id, classification from public.gl_accounts where account_type in ('Income','Expense')),
  act as (
    select date_trunc('month', g.txn_date)::date as m, g.gl_account_id,
           sum(case when g.classification = 'Revenue' then -g.amount else g.amount end) as amt
    from public.v_gl g
    where g.classification in ('Revenue','Expense') and extract(year from g.txn_date) = p_year
    group by 1, 2
  )
  select mo.m, a.id,
         coalesce((select amount from public.budget_amounts x where x.gl_account_id = a.id and x.month = mo.m),
                  (select amount from public.budget_amounts x where x.gl_account_id = a.id and x.month is null), 0),
         coalesce(act.amt, 0)
  from months mo cross join accts a
  left join act on act.m = mo.m and act.gl_account_id = a.id
  where act.amt is not null or exists (select 1 from public.budget_amounts x where x.gl_account_id = a.id)
  order by 1, 2
$$;

-- =====================================================================================
-- 2. Recurring bills and income
-- =====================================================================================
create table if not exists public.recurring_bills (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_income boolean not null default false,
  payee_id uuid references public.payees(id) on delete set null,
  gl_account_id uuid references public.gl_accounts(id) on delete set null,
  amount numeric(14,2) not null check (amount >= 0),
  cadence text not null default 'monthly' check (cadence in ('weekly','biweekly','semimonthly','monthly','quarterly','yearly')),
  -- Bank transactions containing this text are this bill (how "last paid" is found).
  match_text text,
  feed_account_id uuid references public.bank_feed_accounts(id) on delete set null,
  -- Set when you know the next date; otherwise it is worked out from the last payment.
  next_due date,
  autopay boolean not null default true,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Older copies of the table allowed fewer cadences.
alter table public.recurring_bills drop constraint if exists recurring_bills_cadence_check;
alter table public.recurring_bills add constraint recurring_bills_cadence_check
  check (cadence in ('weekly','biweekly','semimonthly','monthly','quarterly','yearly'));

create or replace function public.cadence_interval(c text) returns interval
language sql immutable as $$
  select case c when 'weekly' then interval '7 days' when 'biweekly' then interval '14 days'
                when 'semimonthly' then interval '15 days' when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months'
                else interval '1 year' end
$$;

-- What a bill costs a month on average.
create or replace function public.cadence_monthly(c text, amount numeric) returns numeric
language sql immutable as $$
  select round(amount * case c when 'weekly' then 52.0 / 12 when 'biweekly' then 26.0 / 12 when 'semimonthly' then 2 when 'monthly' then 1
                               when 'quarterly' then 1.0 / 3 else 1.0 / 12 end, 2)
$$;

-- A short, steady key for a bank description ("NETFLIX.COM 866-579" and "NETFLIX.COM 12/03" both NETFLIX COM).
create or replace function public.merchant_key(merchant text, descr text) returns text
language sql immutable as $$
  select nullif(btrim(regexp_replace(upper(left(coalesce(nullif(btrim(merchant), ''),
           regexp_replace(coalesce(descr, ''), '[0-9#*/:.\-]+', ' ', 'g')), 28)), '[^A-Z& ]+|\s+', ' ', 'g')), '')
$$;

create or replace view public.v_recurring_bills with (security_invoker = true) as
with seen as (
  select r.id, max(t.txn_date) as last_seen,
         (array_agg(abs(t.amount) order by t.txn_date desc))[1] as last_amount,
         count(t.id) as times_seen
  from public.recurring_bills r
  left join public.bank_transactions t
    on r.match_text is not null and length(btrim(r.match_text)) >= 2 and t.status <> 'excluded'
   and (r.feed_account_id is null or t.feed_account_id = r.feed_account_id)
   and (t.amount > 0) = r.is_income
   and (upper(concat_ws(' ', t.merchant, t.description, t.original_description)) like '%' || upper(btrim(r.match_text)) || '%'
        or public.merchant_key(t.merchant, coalesce(t.description, t.original_description)) like '%' || upper(btrim(r.match_text)) || '%')
   and t.txn_date > current_date - 400
  group by r.id
),
nxt as (
  select r.*, s.last_seen, s.last_amount, s.times_seen,
         case
           when r.next_due is not null and (s.last_seen is null or r.next_due > s.last_seen) then r.next_due
           when s.last_seen is not null then (s.last_seen + public.cadence_interval(r.cadence))::date
           else r.next_due
         end as next_expected
  from public.recurring_bills r join seen s on s.id = r.id
)
select n.*, py.name as payee_name, a.name as account_name,
       public.cadence_monthly(n.cadence, n.amount) as monthly_amount,
       case when not n.is_active then 'paused'
            when n.next_expected is null then 'unknown'
            when n.next_expected < current_date - 5 then 'late'
            when n.next_expected <= current_date + 7 then 'due soon'
            else 'upcoming' end as state,
       n.next_expected - current_date as days_until
from nxt n
left join public.payees py on py.id = n.payee_id
left join public.gl_accounts a on a.id = n.gl_account_id;

-- Suggestions you said no to.
create table if not exists public.recurring_dismissed (
  merchant_key text primary key,
  dismissed_at timestamptz not null default now()
);

-- Charges (or deposits) that repeat on a schedule and are not a recurring bill yet: same merchant 3 or more
-- times in the last 13 months, a steady gap between them, and amounts within half of each other.
create or replace function public.recurring_candidates()
returns table (merchant_key text, sample text, is_income boolean, times int, avg_amount numeric, last_amount numeric,
               min_amount numeric, max_amount numeric, cadence text, median_gap numeric, last_seen date,
               next_expected date, feed_account_id uuid, gl_account_id uuid)
language sql stable set search_path = public as $$
  with t as (
    select b.*, public.merchant_key(b.merchant, coalesce(b.description, b.original_description)) as k
    from public.bank_transactions b
    where b.status <> 'excluded' and b.txn_date > current_date - 400
      -- Transfers between your own accounts (card payments, savings) are not bills.
      and not exists (select 1 from public.bank_transaction_links l
                      join public.ledger_entries e on e.id = l.source_id
                      where l.bank_transaction_id = b.id and e.entry_type = 'transfer')
  ),
  g as (
    select t.*, t.txn_date - lag(t.txn_date) over (partition by t.k, t.amount > 0 order by t.txn_date) as gap
    from t where t.k is not null
  ),
  s as (
    select k, amount > 0 as is_income, count(*)::int as times, round(avg(abs(amount)), 2) as avg_amount,
           (array_agg(abs(amount) order by txn_date desc))[1] as last_amount,
           min(abs(amount)) as min_amount, max(abs(amount)) as max_amount,
           percentile_cont(0.5) within group (order by gap) as median_gap,
           max(txn_date) as last_seen,
           (array_agg(coalesce(nullif(merchant, ''), description, original_description) order by txn_date desc))[1] as sample,
           (array_agg(feed_account_id order by txn_date desc))[1] as feed_account_id,
           (array_agg(id order by txn_date desc)) as ids
    from g group by k, amount > 0
  ),
  c as (
    select s.*, case when median_gap between 6 and 8 then 'weekly' when median_gap between 13 and 16 then 'biweekly'
                     when median_gap between 26 and 35 then 'monthly' when median_gap between 85 and 97 then 'quarterly'
                     when median_gap between 350 and 380 then 'yearly' end as cadence
    from s where times >= 3 and max_amount <= min_amount * 1.5 + 1
  )
  select c.k, c.sample, c.is_income, c.times, c.avg_amount, c.last_amount, c.min_amount, c.max_amount, c.cadence,
         round(c.median_gap::numeric, 1), c.last_seen, (c.last_seen + public.cadence_interval(c.cadence))::date,
         c.feed_account_id,
         -- The category it went to most recently in the books, if any.
         (select l.gl_account_id from public.bank_transaction_links bl
            join public.ledger_lines l on l.entry_id = bl.source_id
            join public.gl_accounts a on a.id = l.gl_account_id and a.classification in ('Revenue','Expense')
           where bl.bank_transaction_id = any (c.ids) limit 1)
  from c
  where c.cadence is not null
    and c.last_seen + 2 * public.cadence_interval(c.cadence) >= current_date
    and not exists (select 1 from public.recurring_bills r
                    where r.match_text is not null and length(btrim(r.match_text)) >= 2
                      and c.k like '%' || upper(btrim(r.match_text)) || '%')
    and not exists (select 1 from public.recurring_dismissed d where d.merchant_key = c.k)
  order by c.avg_amount desc
$$;

-- =====================================================================================
-- 3. Home screen: everything in one call
-- =====================================================================================
create or replace function public.home_summary(p_today date)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  m_start date := date_trunc('month', p_today)::date;
  lm_start date := (date_trunc('month', p_today) - interval '1 month')::date;
  lm_end date := (date_trunc('month', p_today) - interval '1 day')::date;
  out jsonb := '{}'::jsonb;
  v jsonb;
  attention jsonb := '[]'::jsonb;
  n int; d date; x record;
  -- Charts cover the last 12 months, or since the books start when that is later.
  s12 date := greatest((date_trunc('month', p_today) - interval '11 months')::date,
                       coalesce((select date_trunc('month', ledger_start_date)::date from public.book_settings where id = 1),
                                date '1900-01-01'));
begin
  -- Balances and net worth today.
  select jsonb_agg(jsonb_build_object('id', b.gl_account_id, 'number', b.account_number, 'name', b.account_name,
           'type', b.account_type, 'classification', b.classification, 'balance', b.balance,
           'bank_balance', f.bal, 'bank_balance_as_of', f.as_of, 'for_review', coalesce(f.for_review, 0),
           'linked', f.gl_account_id is not null, 'last_synced_at', f.synced)
           order by public.gl_account_sort(b.classification, b.account_type), b.account_type, b.account_number nulls last, b.account_name)
    into v
  from public.account_balances(p_today) b
  join public.gl_accounts a on a.id = b.gl_account_id
  left join (select gl_account_id, sum(balance) as bal, max(balance_as_of) as as_of, sum(for_review) as for_review,
                    min(last_synced_at) as synced
             from public.v_bank_feed_accounts where is_active group by gl_account_id) f on f.gl_account_id = b.gl_account_id
  where b.classification in ('Asset','Liability') and (a.is_active or b.balance <> 0);
  out := out || jsonb_build_object('accounts', coalesce(v, '[]'::jsonb));

  select jsonb_build_object(
           'cash', coalesce(sum(balance) filter (where account_type = 'Bank'), 0),
           'invested', coalesce(sum(balance) filter (where account_type in ('Investment','Retirement')), 0),
           'other_assets', coalesce(sum(balance) filter (where account_type in ('Property','Vehicle','Other Asset')), 0),
           'cards', coalesce(sum(balance) filter (where account_type = 'Credit Card'), 0),
           'loans', coalesce(sum(balance) filter (where account_type in ('Loan','Mortgage','Other Liability')), 0),
           'assets', coalesce(sum(balance) filter (where classification = 'Asset'), 0),
           'liabilities', coalesce(sum(balance) filter (where classification = 'Liability'), 0),
           'net_worth', coalesce(sum(balance) filter (where classification = 'Asset'), 0)
                        - coalesce(sum(balance) filter (where classification = 'Liability'), 0))
    into v
  from public.account_balances(p_today);
  out := out || jsonb_build_object('totals', v);

  -- This month and last month.
  select jsonb_build_object(
           'income', coalesce(-sum(g.amount) filter (where g.account_type = 'Income' and g.txn_date >= m_start), 0),
           'spending', coalesce(sum(g.amount) filter (where g.account_type = 'Expense' and g.txn_date >= m_start), 0),
           'last_income', coalesce(-sum(g.amount) filter (where g.account_type = 'Income' and g.txn_date < m_start), 0),
           'last_spending', coalesce(sum(g.amount) filter (where g.account_type = 'Expense' and g.txn_date < m_start), 0))
    into v
  from public.v_gl g
  where g.account_type in ('Income','Expense') and g.txn_date between lm_start and p_today;
  out := out || jsonb_build_object('month', v || jsonb_build_object('start', m_start, 'last_start', lm_start, 'last_end', lm_end));

  -- Budget this month.
  select jsonb_build_object(
           'budgeted', coalesce(sum(budget) filter (where section = 'Spending'), 0),
           'spent_in_budget', coalesce(sum(actual) filter (where section = 'Spending' and budget > 0), 0),
           'spent', coalesce(sum(actual) filter (where section = 'Spending'), 0),
           'income_budget', coalesce(sum(budget) filter (where section = 'Income'), 0),
           'over', coalesce(jsonb_agg(jsonb_build_object('id', gl_account_id, 'name', account_name, 'budget', budget,
                                                         'actual', actual) order by actual - budget desc)
                            filter (where section = 'Spending' and budget > 0 and actual > budget), '[]'::jsonb))
    into v
  from public.report_budget(p_today);
  out := out || jsonb_build_object('budget', v);

  -- Spending by group this month.
  select coalesce(jsonb_agg(jsonb_build_object('group', grp, 'amount', amt) order by amt desc), '[]'::jsonb) into v
  from (select coalesce(g.category_group, 'Other') as grp, sum(g.amount) as amt
        from public.v_gl g where g.account_type = 'Expense' and g.txn_date between m_start and p_today
        group by 1 having sum(g.amount) <> 0) s;
  out := out || jsonb_build_object('spending_by_group', v);

  -- Twelve months: income, spending, net worth.
  select coalesce(jsonb_agg(jsonb_build_object('month', mo, 'income', inc, 'spending', sp) order by mo), '[]'::jsonb) into v
  from (
    select m::date as mo,
           coalesce((select -sum(g.amount) from public.v_gl g where g.account_type in ('Income','Other Income')
                       and g.entry_type <> 'valuation'
                       and g.txn_date between m::date and (m + interval '1 month - 1 day')::date), 0) as inc,
           coalesce((select sum(g.amount) from public.v_gl g where g.account_type in ('Expense','Other Expense')
                       and g.entry_type <> 'valuation'
                       and g.txn_date between m::date and (m + interval '1 month - 1 day')::date), 0) as sp
    from generate_series(s12, date_trunc('month', p_today), interval '1 month') m
  ) s;
  out := out || jsonb_build_object('cashflow', v);

  select coalesce(jsonb_agg(to_jsonb(s) order by s.month_end), '[]'::jsonb) into v
  from public.report_net_worth_series(s12, p_today) s;
  out := out || jsonb_build_object('net_worth_series', v);

  -- Bills and income in the next 14 days, and late ones.
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'amount', amount, 'is_income', is_income,
            'next_expected', next_expected, 'state', state, 'days_until', days_until, 'autopay', autopay)
            order by next_expected), '[]'::jsonb) into v
  from public.v_recurring_bills
  where is_active and next_expected is not null and next_expected <= p_today + 14;
  out := out || jsonb_build_object('upcoming', v);

  select jsonb_build_object('monthly_bills', coalesce(sum(monthly_amount) filter (where not is_income), 0),
                            'monthly_income', coalesce(sum(monthly_amount) filter (where is_income), 0),
                            'count', count(*))
    into v
  from public.v_recurring_bills where is_active;
  out := out || jsonb_build_object('recurring', v);

  -- Bank feed.
  select to_jsonb(s) into v from public.bank_feed_state s where id = 1;
  out := out || jsonb_build_object('feed', v);

  -- Needs attention. Each item: kind, title, detail, tone (high, medium, low), link.
  select count(*) into n from public.bank_transactions t join public.bank_feed_accounts f on f.id = t.feed_account_id
    where t.status = 'new' and f.is_active;
  if n > 0 then
    attention := attention || jsonb_build_object('kind', 'review', 'tone', case when n > 25 then 'high' else 'medium' end,
      'title', n || ' bank ' || case when n = 1 then 'transaction' else 'transactions' end || ' to review',
      'detail', 'Categorize them or match them to the books.', 'link', '/transactions');
  end if;

  if exists (select 1 from public.bank_feed_accounts where is_active) then
    select last_sync_at::date into d from public.bank_feed_state where id = 1;
    if d is null or d < p_today - 2 then
      attention := attention || jsonb_build_object('kind', 'feed', 'tone', 'medium',
        'title', 'The bank feed has not synced since ' || coalesce(to_char(d, 'Mon DD'), 'it was set up'),
        'detail', 'Refresh it, or upload a statement if Era lost the connection.', 'link', '/transactions');
    end if;
  end if;

  select count(*) into n from public.v_ledger_exceptions;
  if n > 0 then
    attention := attention || jsonb_build_object('kind', 'ledger', 'tone', 'high',
      'title', n || ' ' || case when n = 1 then 'entry does' else 'entries do' end || ' not balance',
      'detail', 'Open Settings > Books to fix them.', 'link', '/settings?tab=Books');
  end if;

  for x in select name, amount, next_expected, is_income from public.v_recurring_bills where state = 'late' loop
    attention := attention || jsonb_build_object('kind', 'recurring', 'tone', 'medium',
      'title', x.name || case when x.is_income then ' has not come in' else ' has not been paid' end,
      'detail', 'Expected ' || to_char(x.next_expected, 'Mon DD') || ', about ' || to_char(x.amount, 'FM$999,999,990.00') || '.',
      'link', '/recurring');
  end loop;

  for x in select account_name, budget, actual from public.report_budget(p_today)
           where section = 'Spending' and budget > 0 and actual > budget order by actual - budget desc limit 5 loop
    attention := attention || jsonb_build_object('kind', 'budget', 'tone', 'low',
      'title', x.account_name || ' is over budget',
      'detail', to_char(x.actual, 'FM$999,999,990') || ' of ' || to_char(x.budget, 'FM$999,999,990') || ' this month.',
      'link', '/budget');
  end loop;

  select count(distinct g.source_id) into n from public.v_gl g
    join public.book_settings s on s.id = 1
    where g.gl_account_id in (s.uncategorized_expense_gl_id, s.uncategorized_income_gl_id)
      and g.txn_date >= (p_today - 90);
  if n > 0 then
    attention := attention || jsonb_build_object('kind', 'uncategorized', 'tone', 'low',
      'title', n || ' uncategorized ' || case when n = 1 then 'transaction' else 'transactions' end || ' in the last 90 days',
      'detail', 'Give them a category so budgets and taxes are right.', 'link', '/reports?report=General+Ledger&uncategorized=1');
  end if;

  -- Linked bank and card accounts not reconciled in 45 days.
  for x in
    select a.id, a.name, max(r.statement_date) as last
    from public.gl_accounts a
    join public.bank_feed_accounts f on f.gl_account_id = a.id and f.is_active and not f.balance_only
    left join public.reconciliations r on r.gl_account_id = a.id and r.status = 'completed'
    where a.account_type in ('Bank','Credit Card')
    group by a.id, a.name
    having coalesce(max(r.statement_date), date '1900-01-01') < p_today - 45
  loop
    attention := attention || jsonb_build_object('kind', 'reconcile', 'tone', 'low',
      'title', 'Reconcile ' || x.name,
      'detail', case when x.last is null then 'Never reconciled to a statement.'
                     else 'Last reconciled through ' || to_char(x.last, 'Mon DD, YYYY') || '.' end,
      'link', '/accounts?tab=Reconcile&account=' || x.id);
  end loop;

  select max(at)::date into d from public.backup_log;
  if d is not null and d < p_today - 2 then
    attention := attention || jsonb_build_object('kind', 'backup', 'tone', 'medium',
      'title', 'The nightly backup has not run since ' || to_char(d, 'Mon DD'),
      'detail', 'Check the Apps Script trigger in Google Drive.', 'link', '/settings?tab=Backups');
  end if;

  return out || jsonb_build_object('attention', attention);
end $$;

drop trigger if exists budget_amounts_touch on public.budget_amounts;
create trigger budget_amounts_touch before update on public.budget_amounts
  for each row execute function public.touch_updated_at();
drop trigger if exists recurring_bills_touch on public.recurring_bills;
create trigger recurring_bills_touch before update on public.recurring_bills
  for each row execute function public.touch_updated_at();

select 'ok' as personal;

-- ===================================================================================== 5_security.sql
-- Kane Books: access rules, live updates and the audit trail. Run last (after 4_personal.sql), and again
-- after adding any table. Safe to re-run.
--
--   * Every table: row-level security on, one policy for the people on app_users (team_all), checked once
--     per query. user_settings: each login sees only its own row. audit_log: read only.
--   * Logged-out visitors (anon) get nothing except keepalive().
--   * Server-only functions (the Era sync's upsert) and trigger functions are not callable from the API.

do $$
declare t text;
begin
  foreach t in array array[
    'app_users','book_settings','payees','projects','backup_log',
    'gl_accounts','ledger_entries','ledger_lines','reconciliations','reconciliation_items',
    'bank_feed_accounts','bank_feed_state','bank_transactions','bank_transaction_links','bank_rules',
    'budget_amounts','recurring_bills','recurring_dismissed'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists team_all on public.%I', t);
    execute format('create policy team_all on public.%I for all to authenticated using ((select public.is_team())) with check ((select public.is_team()))', t);
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;

  foreach t in array array[
    'book_settings','payees','projects','gl_accounts','ledger_entries','ledger_lines','reconciliations',
    'reconciliation_items','bank_feed_accounts','bank_transactions','bank_transaction_links','bank_rules',
    'budget_amounts','recurring_bills'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row()', t, t);
  end loop;
end $$;

-- Each login's own display settings.
alter table public.user_settings enable row level security;
drop policy if exists own_settings on public.user_settings;
create policy own_settings on public.user_settings for all to authenticated
  using (email = (select public.my_email()) and (select public.is_team()))
  with check (email = (select public.my_email()) and (select public.is_team()));

-- The audit log: readable, written only by the trigger, never edited.
alter table public.audit_log enable row level security;
drop policy if exists team_read on public.audit_log;
create policy team_read on public.audit_log for select to authenticated using ((select public.is_team()));
revoke insert, update, delete, truncate on public.audit_log from authenticated;

-- Grants for signed-in people (policies still decide which rows).
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant select on public.v_gl, public.v_ledger_exceptions, public.v_reconciliation_status, public.v_uncleared,
  public.v_bank_feed_accounts, public.v_bank_transactions, public.v_recurring_bills to authenticated;
grant execute on all functions in schema public to authenticated, service_role;

-- Nothing for logged-out visitors.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
grant execute on function public.keepalive() to anon;

-- Server only: the Era sync writes transactions through its own database connection.
revoke execute on function public.bank_upsert_transactions(uuid, jsonb) from authenticated;

-- Trigger functions are not API calls.
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- Pin the search path on the small helpers (Supabase security advisor).
alter function public.keepalive() set search_path = public;
alter function public.current_actor() set search_path = public;
alter function public.ledger_locks_apply() set search_path = public;
alter function public.is_reconciled(text, uuid) set search_path = public;
alter function public.gl_account_sort(text, text) set search_path = public;
alter function public.pl_section(text) set search_path = public;
alter function public.cadence_interval(text) set search_path = public;
alter function public.cadence_monthly(text, numeric) set search_path = public;
alter function public.merchant_key(text, text) set search_path = public;

-- Check: anon can read no tables (expect 0).
select count(*) filter (where has_table_privilege('anon', c.oid, 'select')) as anon_readable_tables
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'v', 'p', 'm');
