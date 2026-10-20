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
  -- Era can return the same transaction twice in one read (it moves between pages while paging), so each
  -- era_id is taken once; the last copy wins.
  for x in
    select * from (
      select distinct on (e->>'era_id') e->>'era_id' as era_id, (e->>'txn_date')::date as txn_date,
             (e->>'amount')::numeric as amount
      from jsonb_array_elements(p_rows) with ordinality as j(e, i)
      where (e->>'amount')::numeric <> 0
        and not exists (select 1 from public.bank_transactions b where b.era_id = e->>'era_id')
      order by e->>'era_id', i desc
    ) d
    order by d.txn_date
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
    select distinct on (e->>'era_id')
           e->>'era_id' as era_id, (e->>'txn_date')::date as txn_date, (e->>'amount')::numeric as amount,
           e->>'description' as description, e->>'original_description' as original_description,
           e->>'merchant' as merchant, e->>'era_category' as era_category, e->>'transfer_era_id' as transfer_era_id
    from jsonb_array_elements(p_rows) with ordinality as j(e, i)
    where (e->>'amount')::numeric <> 0
    order by e->>'era_id', i desc
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

-- Add many at once (Add all categorized): p_items = [{txn, gl_account_id}]. Each uses its suggestion's payee,
-- memo and project, or the merchant as the payee. A transfer whose other side is already in the books (added
-- earlier in the same batch, say) is matched to that entry instead of being added twice. One that fails is
-- skipped and counted. Returns {added, matched, failed}.
create or replace function public.bank_accept_many(p_items jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  x jsonb; b record; v_gl uuid; v_is_money boolean; c record; n int;
  v_added int := 0; v_matched int := 0; v_failed int := 0;
begin
  for x in select value from jsonb_array_elements(p_items) loop
    begin
      select t.*, f.gl_account_id as feed_gl into b from public.bank_transactions t
      join public.bank_feed_accounts f on f.id = t.feed_account_id
      where t.id = (x->>'txn')::uuid;
      if b.id is null or b.status <> 'new' then continue; end if;
      v_gl := (x->>'gl_account_id')::uuid;
      select a.classification in ('Asset','Liability','Equity') into v_is_money from public.gl_accounts a where a.id = v_gl;
      if v_is_money then
        select count(*) into n from public.bank_candidates(b.id, 5);
        if n >= 1 then
          select * into c from public.bank_candidates(b.id, 5) order by days limit 1;
          perform public.bank_match(b.id, 'entry', c.source_id);
          v_matched := v_matched + 1;
          continue;
        end if;
      end if;
      perform public.bank_accept(b.id, nullif(b.suggestion->>'payee_id', '')::uuid, b.suggestion->>'memo',
        jsonb_build_array(jsonb_build_object('amount', abs(b.amount), 'gl_account_id', v_gl,
                                             'project_id', b.suggestion->>'project_id')),
        null, case when b.suggestion->>'payee_id' is null then b.merchant end);
      v_added := v_added + 1;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('added', v_added, 'matched', v_matched, 'failed', v_failed);
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
    if r.id is null then
      -- 3. No rule: fill in from Era. A transfer Era linked to a transaction on another linked account
      --    points at that account; otherwise the category matching Era's own category.
      v_sugg := null;
      select jsonb_build_object('gl_account_id', f2.gl_account_id, 'source', 'era transfer') into v_sugg
      from public.bank_transactions o join public.bank_feed_accounts f2 on f2.id = o.feed_account_id
      where b.transfer_era_id is not null and o.era_id = b.transfer_era_id
        and f2.gl_account_id is not null and f2.gl_account_id <> b.gl_account_id
      limit 1;
      if v_sugg is null and b.era_category is not null then
        select jsonb_build_object('gl_account_id', a.id, 'source', 'era') into v_sugg
        from public.gl_accounts a
        where a.is_active and lower(a.era_category) = lower(b.era_category)
        order by a.number nulls last limit 1;
      end if;
      -- Only replaces a suggestion that came from Era (a rule's stays until the rule goes).
      if (b.suggestion is null or b.suggestion->>'source' like 'era%') and b.suggestion is distinct from v_sugg then
        update public.bank_transactions set suggestion = v_sugg, updated_at = now() where id = b.id;
      end if;
      if v_sugg is not null then v_suggested := v_suggested + 1; end if;
      continue;
    end if;
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
