#!/usr/bin/env bash
# Rebuild supabase/setup_all.sql (one paste for the Supabase SQL editor) from the numbered files.
set -euo pipefail
cd "$(dirname "$0")/../supabase"
{
  echo "-- Kane Books: the whole database setup in one file, for the Supabase SQL editor."
  echo "-- Built from supabase/1_base.sql to 5_security.sql (run scripts/build-setup-sql.sh after changing them)."
  echo "-- Safe to run more than once."
  for f in 1_base 2_ledger 3_bank_feed 4_personal 5_security; do
    echo
    echo "-- ===================================================================================== $f.sql"
    cat "$f.sql"
  done
} > setup_all.sql
echo "Wrote supabase/setup_all.sql"
