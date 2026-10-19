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
