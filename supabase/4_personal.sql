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
