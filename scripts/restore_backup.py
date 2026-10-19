#!/usr/bin/env python3
"""Turn a nightly backup (kane-books-backup-YYYY-MM-DD.json from the "Kane Books Backups" Drive folder)
into SQL that puts every row back.

    python3 scripts/restore_backup.py kane-books-backup-2026-10-16.json > restore.sql

Run restore.sql in the SQL editor of a database that already has the schema (supabase files 4 onward, in
order). It REPLACES the rows of every table in the backup (truncate, then load), so run it on a new Supabase
project or branch, or on production only to recover from a disaster. Columns the backup has but the database
does not are skipped and listed; triggers and foreign key checks are off while loading, so table order does
not matter; job and document numbers are kept and their counters reset to continue after the highest one.
Files are not in the JSON: they are in the backup's Files folder in Drive and go back into the job-files bucket.
Tested by loading the 2026-10-16 backup into a scratch copy of the schema twice: every table's row count matched.
"""
import json
import sys


def dollar_quote(text: str) -> str:
    tag = "backup"
    while f"${tag}$" in text:
        tag += "x"
    return f"${tag}${text}${tag}$"


def main(path: str) -> None:
    with open(path, encoding="utf-8") as fh:
        backup = json.load(fh)
    tables = {t: rows for t, rows in backup["tables"].items() if rows}
    out = sys.stdout
    out.write(f"-- Restore of {backup.get('app', 'Kane Books')} backup taken {backup.get('created_at')}\n")
    out.write(f"-- {len(tables)} tables with rows, {sum(len(r) for r in tables.values())} rows.\n")
    out.write("set session_replication_role = replica;\nbegin;\n")
    out.write("create temp table _backup (t text primary key, rows jsonb) on commit drop;\n")
    for t, rows in tables.items():
        out.write(f"insert into _backup values ('{t}', {dollar_quote(json.dumps(rows))}::jsonb);\n")
    out.write(
        """
do $$
declare
  b record; cols text; skipped text; n bigint; report text := ''; all_tables text;
begin
  -- Clear every table first: truncating one table can cascade to others, so it must not follow a load.
  select string_agg(format('public.%I', t), ', ') into all_tables
  from _backup where to_regclass('public.' || quote_ident(t)) is not null;
  if all_tables is not null then execute 'truncate ' || all_tables || ' cascade'; end if;
  for b in select * from _backup loop
    if to_regclass('public.' || quote_ident(b.t)) is null then
      report := report || format('table %s is not in this database; ', b.t);
      continue;
    end if;
    select string_agg(quote_ident(k), ', ' order by k) into cols
    from (select distinct jsonb_object_keys(r) as k from jsonb_array_elements(b.rows) r) keys
    where exists (select 1 from information_schema.columns c
                  where c.table_schema = 'public' and c.table_name = b.t and c.column_name = keys.k);
    select string_agg(k, ', ' order by k) into skipped
    from (select distinct jsonb_object_keys(r) as k from jsonb_array_elements(b.rows) r) keys
    where not exists (select 1 from information_schema.columns c
                      where c.table_schema = 'public' and c.table_name = b.t and c.column_name = keys.k);
    execute format('insert into public.%I (%s) overriding system value select %s from jsonb_populate_recordset(null::public.%I, $1)',
                   b.t, cols, cols, b.t) using b.rows;
    get diagnostics n = row_count;
    if n <> jsonb_array_length(b.rows) then raise exception '% loaded % of % rows', b.t, n, jsonb_array_length(b.rows); end if;
    if skipped is not null then report := report || format('%s: skipped columns %s; ', b.t, skipped); end if;
  end loop;
  raise notice 'Restore done. %', coalesce(nullif(report, ''), 'Every column loaded.');
end $$;

-- Counters for identity and serial columns continue after the highest restored value.
do $$
declare c record; seq text; mx bigint;
begin
  for c in select table_name, column_name from information_schema.columns
           where table_schema = 'public' and (is_identity = 'YES' or column_default like 'nextval(%') loop
    seq := pg_get_serial_sequence('public.' || quote_ident(c.table_name), c.column_name);
    if seq is null then continue; end if;
    execute format('select max(%I) from public.%I', c.column_name, c.table_name) into mx;
    if mx is not null then perform setval(seq, mx); end if;
  end loop;
end $$;

commit;
set session_replication_role = origin;
"""
    )
    out.write("select 'restored' as result;\n")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
