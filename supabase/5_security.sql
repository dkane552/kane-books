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
