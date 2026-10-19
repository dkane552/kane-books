import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase, unwrap } from "./supabase";
import { todayISO } from "./format";
import type {
  AppUser,
  AuditRow,
  BankFeedAccount,
  BankFeedState,
  BankRule,
  BankTransaction,
  BookSettings,
  BudgetAmount,
  GlAccount,
  HomeSummary,
  LedgerEntry,
  LedgerException,
  Payee,
  Project,
  RecurringBill,
  ReconciliationItem,
  ReconciliationStatus,
  UnclearedRow,
} from "./types";

// Every query key starts with "db" so a single invalidation refreshes the whole app after a write.
const K = (...parts: unknown[]) => ["db", ...parts];

function useRows<T>(
  key: unknown[],
  fn: () => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  enabled = true,
) {
  return useQuery<T>({
    queryKey: key,
    enabled,
    queryFn: async () => unwrap((await fn()) as { data: T; error: { message: string } | null }),
  });
}

// ---------- reference data ----------
export const useAppUsers = () =>
  useRows<AppUser[]>(K("app_users"), () =>
    supabase.from("app_users").select("*").order("full_name"),
  );
export const useSettings = () =>
  useRows<BookSettings | null>(K("book_settings"), () =>
    supabase.from("book_settings").select("*").eq("id", 1).maybeSingle(),
  );
export const usePayees = () =>
  useRows<Payee[]>(K("payees"), () => supabase.from("payees").select("*").order("name"));
export const useProjects = () =>
  useRows<Project[]>(K("projects"), () =>
    supabase.from("projects").select("*").order("is_active", { ascending: false }).order("name"),
  );
export const useGlAccounts = () =>
  useRows<GlAccount[]>(K("gl_accounts"), () =>
    supabase.from("gl_accounts").select("*").order("number", { nullsFirst: false }).order("name"),
  );

/** True once the schema files have been run (the chart of accounts exists). */
export const useBooksReady = () => {
  const q = useQuery({
    queryKey: K("books_ready"),
    retry: false,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { error } = await supabase.from("gl_accounts").select("id").limit(1);
      return !error;
    },
  });
  return q.isLoading ? undefined : q.data === true;
};

// ---------- the books ----------
export const useLedgerEntries = (from: string, to: string) =>
  useRows<LedgerEntry[]>(K("ledger_entries", from, to), () =>
    supabase
      .from("ledger_entries")
      .select("*, ledger_lines(*)")
      .gte("entry_date", from)
      .lte("entry_date", to)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false }),
  );
export const useLedgerEntry = (id: string | undefined) =>
  useRows<LedgerEntry | null>(
    K("ledger_entry", id),
    () => supabase.from("ledger_entries").select("*, ledger_lines(*)").eq("id", id!).maybeSingle(),
    !!id,
  );
export const useReconciliations = (accountId: string | undefined) =>
  useRows<ReconciliationStatus[]>(
    K("v_reconciliation_status", accountId),
    () =>
      supabase
        .from("v_reconciliation_status")
        .select("*")
        .eq("gl_account_id", accountId!)
        .order("statement_date", { ascending: false }),
    !!accountId,
  );
export const useReconciliationItems = (reconId: string | undefined) =>
  useRows<ReconciliationItem[]>(
    K("reconciliation_items", reconId),
    () => supabase.from("reconciliation_items").select("*").eq("reconciliation_id", reconId!),
    !!reconId,
  );
export const useUncleared = (accountId: string | undefined, through: string) =>
  useRows<UnclearedRow[]>(
    K("v_uncleared", accountId, through),
    () =>
      supabase
        .from("v_uncleared")
        .select("*")
        .eq("gl_account_id", accountId!)
        .lte("txn_date", through)
        .order("txn_date"),
    !!accountId,
  );
export const useLedgerExceptions = () =>
  useRows<LedgerException[]>(K("v_ledger_exceptions"), () =>
    supabase.from("v_ledger_exceptions").select("*").order("txn_date"),
  );
export const useAuditLog = (limit = 100) =>
  useRows<AuditRow[]>(K("audit_log", limit), () =>
    supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(limit),
  );

// ---------- bank feed ----------
export const useBankFeedAccounts = () =>
  useRows<BankFeedAccount[]>(K("v_bank_feed_accounts"), () =>
    supabase.from("v_bank_feed_accounts").select("*").order("name"),
  );
export const useBankTransactions = (since: string) =>
  useRows<BankTransaction[]>(K("v_bank_transactions", since), () =>
    supabase
      .from("v_bank_transactions")
      .select("*")
      .or(`status.eq.new,txn_date.gte.${since}`)
      .order("txn_date", { ascending: false })
      .limit(3000),
  );
export const useBankRules = () =>
  useRows<BankRule[]>(K("bank_rules"), () =>
    supabase.from("bank_rules").select("*").order("position").order("created_at"),
  );
export const useBankFeedState = () =>
  useRows<BankFeedState | null>(K("bank_feed_state"), () =>
    supabase.from("bank_feed_state").select("*").eq("id", 1).maybeSingle(),
  );

/** Call the bank feed program (Supabase Edge Function "era"). */
export async function eraAction<T = Record<string, unknown>>(
  action: "status" | "accounts" | "sync",
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("era", { body: { action } });
  if (error) {
    let message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const body = await ctx.json().catch(() => null);
      if (body?.error) message = body.error;
    }
    throw new Error(message);
  }
  return data as T;
}

// ---------- budgets, recurring, home ----------
export const useBudgetAmounts = () =>
  useRows<BudgetAmount[]>(K("budget_amounts"), () => supabase.from("budget_amounts").select("*"));
export const useRecurringBills = () =>
  useRows<RecurringBill[]>(K("v_recurring_bills"), () =>
    supabase
      .from("v_recurring_bills")
      .select("*")
      .order("is_active", { ascending: false })
      .order("name"),
  );
export const useHome = () =>
  useQuery<HomeSummary>({
    queryKey: K("home_summary"),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("home_summary", { p_today: todayISO() });
      if (error) throw new Error(error.message);
      return data as HomeSummary;
    },
  });

/** Call a report function (Postgres RPC) and return its rows. */
export async function rpcRows<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
export const useReport = <T>(fn: string, args: Record<string, unknown>, enabled = true) =>
  useQuery<T[]>({
    queryKey: K("report", fn, args),
    enabled,
    placeholderData: (prev) => prev,
    queryFn: () => rpcRows<T>(fn, args),
  });

/** Run a database function that changes the books; throws the database's message. */
export async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as unknown;
}

// ---------- writes ----------
/** When this browser last saved something (its own refresh already covers the realtime echo). */
let lastLocalWrite = 0;

export function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    lastLocalWrite = Date.now();
    return qc.invalidateQueries({ queryKey: ["db"] });
  };
}

// Tables whose rows only show up in their own lists. A change to any other table can move money or totals
// anywhere, so it refreshes everything.
const NARROW_TABLES: Record<string, string[]> = {
  app_users: ["app_users"],
  backup_log: ["backup_log", "home_summary"],
  audit_log: ["audit_log"],
  payees: ["payees"],
  user_settings: [],
};

/** Refresh only what the changed tables can affect. Returns the query key names it refreshed. */
export function refreshForTables(
  qc: ReturnType<typeof useQueryClient>,
  tables: Iterable<string>,
): "all" | string[] {
  const keys = new Set<string>();
  for (const t of tables) {
    const narrow = NARROW_TABLES[t];
    if (!narrow) {
      void qc.invalidateQueries({ queryKey: ["db"] });
      return "all";
    }
    narrow.forEach((k) => keys.add(k));
  }
  if (keys.size)
    void qc.invalidateQueries({
      predicate: (q) => q.queryKey[0] === "db" && keys.has(String(q.queryKey[1])),
    });
  return [...keys];
}

/**
 * Live updates: when the bank feed (or another device) changes something, open screens refresh. Changes are
 * gathered for a moment and refreshed once, a hidden tab waits until it is shown again, and this browser's
 * own saves are skipped (they already refreshed).
 */
export function useLiveRefresh(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstAt = 0;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      firstAt = 0;
      if (!pending.size) return;
      if (typeof document !== "undefined" && document.hidden) return;
      const tables = [...pending];
      pending.clear();
      refreshForTables(qc, tables);
    };
    const onChange = (payload: { table?: string }) => {
      if (Date.now() - lastLocalWrite < 2000) return;
      pending.add(payload.table ?? "*");
      const now = Date.now();
      if (!firstAt) firstAt = now;
      clearTimeout(timer);
      timer = setTimeout(flush, Math.max(0, Math.min(800, firstAt + 3000 - now)));
    };
    const onVisible = () => {
      if (!document.hidden) flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    const channel = supabase
      .channel("kane-books-live")
      .on("postgres_changes", { event: "*", schema: "public" }, onChange)
      .subscribe();
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [enabled, qc]);
}

type Row = Record<string, unknown>;

/** Generic insert/update/upsert/delete with app-wide refresh and an error toast. */
export function useDb() {
  const invalidate = useInvalidate();
  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error("Could not save", { description: e.message }),
  });
  return {
    pending: run.isPending,
    insert: <T = Row>(table: string, values: Row | Row[]) =>
      run.mutateAsync(async () =>
        unwrap(await supabase.from(table).insert(values).select()),
      ) as Promise<[T, ...T[]]>,
    update: <T = Row>(table: string, id: string, values: Row, idColumn = "id") =>
      run.mutateAsync(async () =>
        unwrap(await supabase.from(table).update(values).eq(idColumn, id).select()),
      ) as Promise<[T, ...T[]]>,
    upsert: <T = Row>(table: string, values: Row | Row[], onConflict?: string) =>
      run.mutateAsync(async () =>
        unwrap(
          await supabase
            .from(table)
            .upsert(values, onConflict ? { onConflict } : undefined)
            .select(),
        ),
      ) as Promise<T[]>,
    remove: (table: string, id: string, idColumn = "id") =>
      run.mutateAsync(async () => unwrap(await supabase.from(table).delete().eq(idColumn, id))),
    /** Run several writes as one refresh. */
    batch: <T = unknown>(fn: () => Promise<T>) => run.mutateAsync(fn) as Promise<T>,
  };
}

// ---------- backups ----------
export interface BackupLog {
  id: number;
  at: string;
  tables: number;
  rows: number;
  files: number;
}
export const useBackupLog = () =>
  useRows<BackupLog[]>(K("backup_log"), () =>
    supabase.from("backup_log").select("*").order("id", { ascending: false }).limit(10),
  );
