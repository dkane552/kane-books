// Transactions: the bank feed (bank and card transactions from Era or uploaded statements, matched to the
// books or added to them) and every entry in the books. Schema in supabase/3_bank_feed.sql.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Landmark,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DataTable,
  EmptyState,
  Field,
  FormDialog,
  LocalTabs,
  Money,
  PageHeading,
  Panel,
  Select,
  StatusPill,
  confirmAction,
  type Column,
} from "./shared";
import { AccountOptions, PayeeInput, ProjectOptions } from "./pickers";
import { EntryDialog, payeeId } from "./entry-dialog";
import { ENTRY_KIND, PeekName, usePeek } from "./peek";
import {
  eraAction,
  rpc,
  useBankFeedAccounts,
  useBankFeedState,
  useBankRules,
  useBankTransactions,
  useDb,
  useGlAccounts,
  useLedgerEntries,
  useLedgerEntry,
  usePayees,
  useProjects,
  useReport,
  useSettings,
} from "@/lib/data";
import { supabase } from "@/lib/supabase";
import { addDays, fmtDate, money, num, todayISO } from "@/lib/format";
import { guessMapping, parseCsv, toStatementRows, type StatementMapping } from "@/lib/csv";
import { BALANCE_TYPES, CATEGORY_TYPES, FEED_TYPES, TYPE_LABEL, glLabel } from "@/lib/accounts";
import type {
  BankCandidate,
  BankFeedAccount,
  BankTransaction,
  EraAccount,
  GlAccountType,
  LedgerEntry,
  LedgerEntryType,
} from "@/lib/types";

const FILTERS = ["For review", "Matched", "Added", "Excluded", "All"] as const;
type Filter = (typeof FILTERS)[number];
const STATUS_FOR: Record<Filter, BankTransaction["status"] | null> = {
  "For review": "new",
  Matched: "matched",
  Added: "added",
  Excluded: "excluded",
  All: null,
};
const AUTO_SYNC_HOURS = 3;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const describe = (t: BankTransaction) =>
  t.merchant || t.description || t.original_description || "";

export function TransactionsPage({
  tab,
  onTab,
  entry,
}: {
  tab: string;
  onTab: (t: string) => void;
  entry?: string | undefined;
}) {
  return (
    <>
      <PageHeading
        title="Transactions"
        eyebrow="MONEY IN AND OUT"
        subtitle="Bank and card activity to categorize, and every entry in the books."
      />
      <Panel>
        <div className="px-3">
          <LocalTabs options={["Bank feed", "Entries"]} value={tab} onChange={onTab} />
        </div>
        {tab === "Entries" ? <EntriesTab openId={entry} /> : <BankFeedTab />}
      </Panel>
    </>
  );
}

function useEraStatus() {
  return useQuery({
    queryKey: ["era-status"],
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: () => eraAction<{ configured: boolean }>("status"),
  });
}

// =====================================================================================
// Bank feed
// =====================================================================================
function BankFeedTab() {
  const { data: feeds } = useBankFeedAccounts();
  const since = useMemo(() => addDays(todayISO(), -180), []);
  const { data: txns, isLoading } = useBankTransactions(since);
  const { data: state } = useBankFeedState();
  const { data: gl } = useGlAccounts();
  const { data: projects } = useProjects();
  const era = useEraStatus();
  const db = useDb();
  const { show } = usePeek();
  const [filter, setFilter] = useState<Filter>("For review");
  const [account, setAccount] = useState("");
  const [search, setSearch] = useState("");
  const [reviewing, setReviewing] = useState<BankTransaction | null>(null);
  const [setup, setSetup] = useState(false);
  const [upload, setUpload] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [quick, setQuick] = useState<Record<string, string>>({});
  const autoRan = useRef(false);

  async function sync(manual: boolean) {
    setSyncing(true);
    try {
      const r = await eraAction<{
        ok?: boolean;
        skipped?: boolean;
        error?: string;
        status?: string;
      }>("sync");
      await db.batch(async () => undefined);
      if (!manual) return;
      if (r.error) toast.error("Bank sync failed", { description: r.error });
      else if (r.skipped) toast("A bank sync is already running");
      else toast.success("Bank feed updated", { description: r.status });
    } catch (e) {
      if (manual) toast.error("Bank sync failed", { description: errMsg(e) });
    } finally {
      setSyncing(false);
    }
  }

  // Era refreshes from the banks about once a day, so sync when the tab opens if it has been a while.
  useEffect(() => {
    if (autoRan.current || !era.data?.configured || state === undefined) return;
    const last = state?.last_sync_at ? new Date(state.last_sync_at).getTime() : 0;
    if (Date.now() - last > AUTO_SYNC_HOURS * 3600 * 1000 && (feeds ?? []).length) {
      autoRan.current = true;
      void sync(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [era.data?.configured, state, feeds]);

  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = useMemo(
    () =>
      (txns ?? []).filter(
        (t) =>
          (!STATUS_FOR[filter] || t.status === STATUS_FOR[filter]) &&
          (!account || t.feed_account_id === account) &&
          words.every((w) =>
            `${describe(t)} ${t.original_description ?? ""} ${num(t.amount).toFixed(2)}`
              .toLowerCase()
              .includes(w),
          ),
      ),
    [txns, filter, account, words],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) {
      const s = STATUS_FOR[f];
      c[f] = (txns ?? []).filter(
        (t) => (!s || t.status === s) && (!account || t.feed_account_id === account),
      ).length;
    }
    return c;
  }, [txns, account]);
  const suggested = rows.filter(
    (t) => t.status === "new" && (quick[t.id] || t.suggestion?.gl_account_id),
  );

  async function quickAdd(t: BankTransaction) {
    const cat = quick[t.id] || t.suggestion?.gl_account_id;
    if (!cat) return setReviewing(t);
    await db.batch(() =>
      rpc("bank_accept", {
        p_txn: t.id,
        p_payee: t.suggestion?.payee_id ?? null,
        p_memo: t.suggestion?.memo ?? null,
        p_lines: [
          {
            amount: Math.abs(num(t.amount)),
            gl_account_id: cat,
            project_id: t.suggestion?.project_id ?? null,
          },
        ],
      }),
    );
  }

  async function addAllSuggested() {
    if (!confirmAction(`Add ${suggested.length} transactions with the categories shown?`)) return;
    let done = 0;
    for (const t of suggested) {
      try {
        await quickAdd(t);
        done++;
      } catch {
        break;
      }
    }
    toast.success(`${done} added to the books`);
  }

  const cols: Column<BankTransaction>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (r) => r.txn_date,
      render: (r) => fmtDate(r.txn_date),
    },
    {
      key: "acct",
      header: "Account",
      sortValue: (r) => r.account_name,
      render: (r) => (
        <span className="text-xs">
          {r.account_name}
          {r.account_mask && <span className="text-muted-foreground"> {r.account_mask}</span>}
        </span>
      ),
    },
    {
      key: "desc",
      header: "Description",
      sortValue: describe,
      render: (r) => (
        <div className="max-w-[300px]">
          <div className="truncate">{describe(r)}</div>
          {r.original_description && r.original_description !== describe(r) && (
            <div className="truncate text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
              {r.original_description}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      sortValue: (r) => num(r.amount),
      render: (r) => <Money value={r.amount} />,
    },
    {
      key: "cat",
      header: filter === "For review" ? "Category" : "Status",
      render: (r) =>
        r.status === "new" ? (
          <div className="min-w-[180px]" onClick={(e) => e.stopPropagation()}>
            <Select
              value={quick[r.id] ?? r.suggestion?.gl_account_id ?? ""}
              onChange={(v) => setQuick((q) => ({ ...q, [r.id]: v }))}
              ariaLabel="Category"
            >
              <option value="">Choose a category</option>
              <AccountOptions
                accounts={gl}
                types={[...CATEGORY_TYPES, ...BALANCE_TYPES]}
                exclude={r.gl_account_id}
              />
            </Select>
            {r.suggestion?.project_id && !quick[r.id] && (
              <div className="mt-0.5 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                Project: {projects?.find((p) => p.id === r.suggestion?.project_id)?.name}
              </div>
            )}
          </div>
        ) : r.status === "matched" || r.status === "added" ? (
          <PeekName target={linkTarget(r)} title="Open the entry">
            <StatusPill tone="approved">{r.status === "matched" ? "Matched" : "Added"}</StatusPill>
          </PeekName>
        ) : (
          <StatusPill tone="void">Excluded</StatusPill>
        ),
    },
    {
      key: "act",
      header: "",
      render: (r) =>
        r.status === "new" ? (
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              disabled={!(quick[r.id] || r.suggestion?.gl_account_id) || db.pending}
              onClick={(e) => {
                e.stopPropagation();
                void quickAdd(r);
              }}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={(e) => {
                e.stopPropagation();
                setReviewing(r);
              }}
            >
              More
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={async (e) => {
              e.stopPropagation();
              const what =
                r.status === "added"
                  ? "Put this back in For review? The entry the feed added is removed."
                  : "Put this back in For review?";
              if (!confirmAction(what)) return;
              await db.batch(() => rpc("bank_undo", { p_txn: r.id }));
            }}
          >
            <Undo2 />
            Undo
          </Button>
        ),
    },
  ];

  if (era.isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  const eraReady = !era.error && !!era.data?.configured;

  return (
    <>
      {!eraReady && (
        <div className="mx-3 mt-3 rounded-md bg-accent p-3 text-[length:calc(11px*var(--ts,1))] leading-relaxed">
          Era is not connected
          {era.error
            ? ` (${errMsg(era.error)})`
            : ": add the ERA_API_KEY secret in Supabase (Edge Functions > Secrets)"}
          . Until then, add accounts in Accounts and upload statements from each bank's website with
          Upload statement.
        </div>
      )}
      {(feeds ?? []).length > 0 && (
        <div className="grid gap-2 px-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">
          {groupByGl(feeds ?? []).map((g) => (
            <AccountCard
              key={g.glId ?? g.feeds[0]!.id}
              group={g}
              onReview={() => {
                setFilter("For review");
                setAccount(g.feeds.length === 1 ? g.feeds[0]!.id : "");
              }}
            />
          ))}
        </div>
      )}
      <div className="toolbar">
        <LocalTabs
          options={[...FILTERS]}
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          counts={counts}
        />
        <select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)}>
          <option value="">All accounts</option>
          {(feeds ?? []).map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} {f.mask ?? ""}
            </option>
          ))}
        </select>
        <Input
          className="h-8 w-44"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search transactions"
        />
        <div className="toolbar-end ml-auto flex flex-wrap items-center gap-2">
          <span className="hidden text-[length:calc(11px*var(--ts,1))] text-muted-foreground md:inline">
            {state?.last_error
              ? state.last_error
              : state?.last_sync_at
                ? `Synced ${new Date(state.last_sync_at).toLocaleString()}`
                : "Not synced yet"}
          </span>
          {filter === "For review" && suggested.length > 1 && (
            <Button size="sm" variant="outline" onClick={addAllSuggested} disabled={db.pending}>
              <Sparkles />
              Add {suggested.length} categorized
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setUpload(true)}
            disabled={!(feeds ?? []).length}
          >
            <Upload />
            Upload statement
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSetup(true)}>
            <Settings2 />
            Accounts and rules
          </Button>
          <Button size="sm" onClick={() => sync(true)} disabled={syncing || !eraReady}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        </div>
      </div>
      {!(feeds ?? []).length ? (
        <EmptyState
          icon={Landmark}
          title="No bank or card accounts linked yet"
          description="Open Accounts and rules to link your Era accounts (each one becomes an account in your books), or add an account by hand in Accounts and upload its statements."
        />
      ) : (
        <DataTable
          rows={rows}
          columns={cols}
          loading={isLoading}
          rowKey={(r) => r.id}
          initialSort={{ key: "date", dir: "desc" }}
          onRowClick={(r) => {
            if (r.status === "new") return setReviewing(r);
            const t = linkTarget(r);
            if (t) show(t);
          }}
          empty={
            <EmptyState
              compact
              title={filter === "For review" ? "Nothing to review" : "No transactions here"}
              {...(filter === "For review"
                ? { description: "Everything from the bank is matched to the books or added." }
                : {})}
            />
          }
          footerNote="Pick a category and Add, or More to split it, match it or make a rule. Transactions match the books on their own when the amount and date line up."
        />
      )}
      {reviewing && (
        <ReviewDialog
          txn={reviewing}
          onClose={() => setReviewing(null)}
          feed={(feeds ?? []).find((f) => f.id === reviewing.feed_account_id)}
        />
      )}
      {setup && <SetupDialog onClose={() => setSetup(false)} />}
      {upload && <StatementDialog feeds={feeds ?? []} onClose={() => setUpload(false)} />}
    </>
  );
}

function linkTarget(t: BankTransaction) {
  const l = t.links?.find((x) => x.created) ?? t.links?.[0];
  return l ? ({ kind: "entry", id: l.source_id } as const) : undefined;
}

interface GlGroup {
  glId: string | null;
  feeds: BankFeedAccount[];
}
function groupByGl(feeds: BankFeedAccount[]): GlGroup[] {
  const out: GlGroup[] = [];
  for (const f of feeds.filter((x) => x.is_active)) {
    const g = out.find((x) => x.glId === f.gl_account_id);
    if (g) g.feeds.push(f);
    else out.push({ glId: f.gl_account_id, feeds: [f] });
  }
  return out;
}

/** One card per books account: the bank's balance next to the books'. */
function AccountCard({ group, onReview }: { group: GlGroup; onReview: () => void }) {
  const { show } = usePeek();
  const first = group.feeds[0]!;
  const latest = [...group.feeds].sort((a, b) =>
    (b.balance_as_of ?? "").localeCompare(a.balance_as_of ?? ""),
  )[0]!;
  const owed = first.gl_classification === "Liability";
  const bankBal = latest.balance === null ? null : num(latest.balance);
  const books = num(first.books_balance);
  const diff = bankBal === null ? null : Math.round((bankBal - books) * 100) / 100;
  const review = group.feeds.reduce((s, f) => s + Number(f.for_review || 0), 0);
  const target = group.glId ? ({ kind: "gl", id: group.glId } as const) : undefined;
  return (
    <div
      className={`rounded-md border p-3 text-sm ${target ? "metric-link cursor-pointer" : ""}`}
      onClick={target ? () => show(target) : undefined}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-medium">
          <PeekName target={target} title="See this account's activity">
            {first.gl_account_name ?? "Not linked"}
          </PeekName>
        </div>
        {review > 0 && (
          <button
            type="button"
            className="peek-link"
            title="Show these in For review"
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
          >
            <StatusPill tone="pending">{review} to review</StatusPill>
          </button>
        )}
      </div>
      <div className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
        {group.feeds.map((f) => `${f.name} ${f.mask ?? ""}`.trim()).join(", ")}
        {first.balance_only ? " · balance only" : ""}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
        <span className="text-muted-foreground">
          {owed ? "Owed, per the bank" : "Bank balance"}
        </span>
        <span className="number text-right">{bankBal === null ? "" : money(bankBal)}</span>
        <span className="text-muted-foreground">
          {owed ? "Owed, per the books" : "In the books"}
        </span>
        <span className="number text-right">{money(books)}</span>
        {diff !== null && diff !== 0 && (
          <>
            <span className="text-muted-foreground">Difference</span>
            <span className="number text-right text-destructive">{money(diff)}</span>
          </>
        )}
      </div>
      {latest.balance_as_of && (
        <div className="mt-1 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
          Bank balance as of {new Date(latest.balance_as_of).toLocaleString()}
        </div>
      )}
    </div>
  );
}

// -------------------------------------------------------------------------------------
// Upload statement: a CSV export from the bank's website.
function StatementDialog({ feeds, onClose }: { feeds: BankFeedAccount[]; onClose: () => void }) {
  const db = useDb();
  const usable = feeds.filter((f) => !f.balance_only);
  const [feed, setFeed] = useState(usable.length === 1 ? usable[0]!.id : "");
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][]>([]);
  const [map, setMap] = useState<StatementMapping | null>(null);
  const [busy, setBusy] = useState(false);
  const header = table[0] ?? [];
  const parsed = useMemo(
    () => (map ? toStatementRows(table.slice(1), map) : { rows: [], skipped: 0 }),
    [table, map],
  );
  const moneyIn = parsed.rows.filter((r) => r.amount > 0).reduce((s, r) => s + r.amount, 0);
  const moneyOut = parsed.rows.filter((r) => r.amount < 0).reduce((s, r) => s + r.amount, 0);
  const dates = parsed.rows.map((r) => r.txn_date).sort();

  async function read(file: File | undefined) {
    if (!file) return;
    const rows = parseCsv(await file.text());
    // Some banks put a few lines of account details above the column names.
    const start = rows.findIndex((r) => r.some((c) => /date/i.test(c)));
    const t = start > 0 ? rows.slice(start) : rows;
    setFileName(file.name);
    setTable(t);
    setMap(t.length ? guessMapping(t[0]!) : null);
  }

  const col = (key: keyof Omit<StatementMapping, "flip">, label: string, optional = false) => (
    <Field label={label}>
      <Select
        value={String(map?.[key] ?? -1)}
        onChange={(v) => map && setMap({ ...map, [key]: Number(v) })}
      >
        <option value="-1">{optional ? "None" : "Pick a column"}</option>
        {header.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </Select>
    </Field>
  );

  async function submit() {
    if (!feed) return void toast.error("Pick the account this statement is for");
    if (!parsed.rows.length) return void toast.error("No transactions found in this file");
    setBusy(true);
    try {
      const r = (await db.batch(() =>
        rpc("bank_import_statement", { p_feed_account: feed, p_rows: parsed.rows }),
      )) as { added: number; already_in: number; auto?: { matched?: number } } | undefined;
      toast.success(`${r?.added ?? 0} transactions added`, {
        description: `${r?.already_in ?? 0} were already in the feed. ${r?.auto?.matched ?? 0} matched the books.`,
      });
      onClose();
    } catch {
      // shown
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Upload statement"
      description="A CSV export of transactions from the bank or card website. Anything already in the feed is skipped, so overlapping dates are fine."
      onSubmit={submit}
      submitLabel={busy ? "Uploading" : `Add ${parsed.rows.length} transactions`}
      busy={busy}
      wide
    >
      <Field label="Account">
        <Select value={feed} onChange={setFeed} required>
          <option value="">Pick an account</option>
          {usable.map((f) => (
            <option key={f.id} value={f.id}>
              {f.institution ? `${f.institution} ` : ""}
              {f.name} {f.mask ?? ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Statement file (CSV)">
        <Input type="file" accept=".csv,text/csv" onChange={(e) => read(e.target.files?.[0])} />
      </Field>
      {map && (
        <>
          {col("date", "Date column")}
          {col("description", "Description column")}
          {col("amount", "Amount column (one column, money out negative)", true)}
          {map.amount < 0 && col("debit", "Money out column")}
          {map.amount < 0 && col("credit", "Money in column")}
          <label className="field full flex items-center gap-2 text-xs">
            <Checkbox
              checked={map.flip}
              onCheckedChange={(v) => setMap({ ...map, flip: v === true })}
            />
            Charges show as positive numbers in this file (flip the signs)
          </label>
          <div className="field full text-[length:calc(11px*var(--ts,1))] leading-relaxed text-muted-foreground">
            {fileName}: {parsed.rows.length} transactions
            {dates.length ? ` from ${fmtDate(dates[0]!)} to ${fmtDate(dates.at(-1)!)}` : ""}, money
            in {money(moneyIn)}, money out {money(-moneyOut)}
            {parsed.skipped
              ? `. ${parsed.skipped} lines without a date or amount are left out.`
              : "."}{" "}
            Check that charges show as negative below.
          </div>
          <div className="field full max-h-56 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <tbody>
                {parsed.rows.slice(0, 12).map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="whitespace-nowrap px-2 py-1">{fmtDate(r.txn_date)}</td>
                    <td className="px-2 py-1">{r.description}</td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      <Money value={r.amount} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </FormDialog>
  );
}

// =====================================================================================
interface Line {
  amount: string;
  gl_account_id: string;
  project_id: string;
  description: string;
}
const blankLine = (amount = ""): Line => ({
  amount,
  gl_account_id: "",
  project_id: "",
  description: "",
});

function ReviewDialog({
  txn,
  feed,
  onClose,
}: {
  txn: BankTransaction;
  feed: BankFeedAccount | undefined;
  onClose: () => void;
}) {
  const db = useDb();
  const { data: gl } = useGlAccounts();
  const { data: payees } = usePayees();
  const { data: candidates, isLoading: loadingCandidates } = useReport<BankCandidate>(
    "bank_candidates",
    {
      p_txn: txn.id,
      p_days: 30,
    },
  );
  const amount = num(txn.amount);
  const out = amount < 0;
  const abs = Math.abs(amount);
  const s = txn.suggestion;
  const [payee, setPayee] = useState("");
  const [memo, setMemo] = useState(s?.memo ?? describe(txn));
  const [lines, setLines] = useState<Line[]>([
    {
      ...blankLine(abs.toFixed(2)),
      gl_account_id: s?.gl_account_id ?? "",
      project_id: s?.project_id ?? "",
    },
  ]);
  const [ruleOn, setRuleOn] = useState(false);
  const [ruleText, setRuleText] = useState((txn.merchant || txn.description || "").slice(0, 40));
  const [ruleAuto, setRuleAuto] = useState(false);
  const total = lines.reduce((t, l) => t + Number(l.amount || 0), 0);
  const left = Math.round((abs - total) * 100) / 100;
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  useEffect(() => {
    const id = s?.payee_id;
    if (id && payees) setPayee(payees.find((p) => p.id === id)?.name ?? "");
    else if (!payee && txn.merchant) setPayee(txn.merchant);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payees]);

  async function match(c: BankCandidate) {
    await db.batch(() =>
      rpc("bank_match", { p_txn: txn.id, p_source: c.source, p_source_id: c.source_id }),
    );
    toast.success("Matched");
    onClose();
  }

  async function add() {
    if (Math.abs(left) > 0.004)
      return void toast.error(
        `The lines are ${money(Math.abs(left))} ${left > 0 ? "short" : "over"}.`,
      );
    if (lines.some((l) => Number(l.amount) && !l.gl_account_id))
      return void toast.error("Every line needs a category");
    try {
      await db.batch(async () => {
        const pid = await payeeId(payee);
        await rpc("bank_accept", {
          p_txn: txn.id,
          p_payee: pid,
          p_memo: memo || null,
          p_lines: lines
            .filter((l) => Number(l.amount))
            .map((l) => ({
              amount: Number(l.amount),
              gl_account_id: l.gl_account_id || null,
              project_id: l.project_id || null,
              description: l.description || null,
            })),
          p_rule:
            ruleOn && ruleText.trim() ? { contains: ruleText.trim(), auto_add: ruleAuto } : null,
        });
      });
      toast.success("Added to the books");
      onClose();
    } catch {
      // shown
    }
  }

  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`${out ? "Money out" : "Money in"}: ${money(abs)}`}
      description={`${fmtDate(txn.txn_date)} · ${txn.account_name} ${txn.account_mask ?? ""} · ${txn.original_description ?? describe(txn)}`}
      wide
      busy={db.pending}
      submitLabel="Add to books"
      onSubmit={add}
      footerLeft={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            if (
              !confirmAction(
                "Exclude this transaction? Use this for duplicates or anything that is not yours.",
              )
            )
              return;
            await db.batch(() => rpc("bank_exclude", { p_txn: txn.id }));
            onClose();
          }}
        >
          Exclude
        </Button>
      }
    >
      <div className="full col-span-2">
        <div className="mb-1 text-xs font-medium">Match to something already in the books</div>
        {loadingCandidates ? (
          <div className="text-xs text-muted-foreground">Looking…</div>
        ) : candidates?.length ? (
          <table className="data-table">
            <tbody>
              {candidates.map((c) => (
                <tr key={`${c.source}:${c.source_id}`}>
                  <td className="w-24">{fmtDate(c.txn_date)}</td>
                  <td>{c.label}</td>
                  <td className="text-right">
                    <Money value={c.amount} />
                  </td>
                  <td className="w-20 text-right">
                    <Button type="button" size="sm" variant="outline" onClick={() => match(c)}>
                      <Link2 />
                      Match
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="text-xs text-muted-foreground">
            Nothing in the books on this account has this amount within 30 days. Add it below.
          </div>
        )}
      </div>

      <div className="full col-span-2 mt-2 text-xs font-medium">Or add it to the books</div>
      <Field label={out ? "Payee" : "Received from"}>
        <PayeeInput value={payee} onChange={setPayee} />
      </Field>
      <Field label="Memo">
        <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      <div className="full col-span-2">
        <div className="data-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Project</th>
                <th>Description</th>
                <th className="numeric">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="min-w-[200px]">
                    <Select
                      value={l.gl_account_id}
                      onChange={(v) => setLine(i, { gl_account_id: v })}
                      ariaLabel="Category"
                      required
                    >
                      <option value="">Choose a category</option>
                      <AccountOptions
                        accounts={gl}
                        types={[...CATEGORY_TYPES, ...BALANCE_TYPES]}
                        exclude={feed?.gl_account_id}
                        keep={l.gl_account_id}
                      />
                    </Select>
                  </td>
                  <td className="min-w-[130px]">
                    <Select
                      value={l.project_id}
                      onChange={(v) => setLine(i, { project_id: v })}
                      ariaLabel="Project"
                    >
                      <option value="">None</option>
                      <ProjectOptions keep={l.project_id} />
                    </Select>
                  </td>
                  <td>
                    <Input
                      value={l.description}
                      onChange={(e) => setLine(i, { description: e.target.value })}
                      aria-label="Description"
                    />
                  </td>
                  <td className="w-28">
                    <Input
                      type="number"
                      step="0.01"
                      value={l.amount}
                      onChange={(e) => setLine(i, { amount: e.target.value })}
                      aria-label="Amount"
                    />
                  </td>
                  <td>
                    {lines.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Remove line"
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setLines((ls) => [...ls, blankLine(left > 0 ? left.toFixed(2) : "")])}
          >
            <Plus />
            Split
          </Button>
          <span className={Math.abs(left) > 0.004 ? "text-destructive" : "text-muted-foreground"}>
            {Math.abs(left) > 0.004
              ? `${money(Math.abs(left))} ${left > 0 ? "left to assign" : "too much"}`
              : "Lines add up"}
          </span>
        </div>
        <p className="mt-2 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
          Pick a spending or income category, or another of your accounts to record a transfer (a
          card payment, moving money to savings, a loan payment).
        </p>
      </div>
      {lines.length === 1 && (
        <div className="full col-span-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-2">
            <Checkbox checked={ruleOn} onCheckedChange={(v) => setRuleOn(v === true)} />
            Next time, suggest this for transactions containing
          </label>
          <Input
            className="h-7 w-48"
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
            aria-label="Rule text"
            disabled={!ruleOn}
          />
          <label className="flex items-center gap-2">
            <Checkbox
              checked={ruleAuto}
              disabled={!ruleOn}
              onCheckedChange={(v) => setRuleAuto(v === true)}
            />
            and add them without asking
          </label>
        </div>
      )}
    </FormDialog>
  );
}

// =====================================================================================
/** Which account type a new books account should be for an Era account. */
function guessType(t: string | null): GlAccountType {
  const s = (t ?? "").toLowerCase();
  if (/credit/.test(s)) return "Credit Card";
  if (/mortgage/.test(s)) return "Mortgage";
  if (/loan|student|auto/.test(s)) return "Loan";
  if (/401|ira|retire|roth|403|pension/.test(s)) return "Retirement";
  if (/invest|brokerage|stock|crypto/.test(s)) return "Investment";
  return "Bank";
}

function SetupDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const { data: feeds } = useBankFeedAccounts();
  const { data: rules } = useBankRules();
  const { data: gl } = useGlAccounts();
  const { data: projects } = useProjects();
  const { data: settings } = useSettings();
  const [eraAccounts, setEraAccounts] = useState<EraAccount[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<Record<string, string>>({});
  const linked = new Set((feeds ?? []).map((f) => f.era_account_key));
  const glName = (id: string | null) => {
    const a = gl?.find((x) => x.id === id);
    return a ? glLabel(a) : "";
  };

  async function loadEra() {
    setLoading(true);
    try {
      const r = await eraAction<{ accounts: EraAccount[] }>("accounts");
      setEraAccounts(r.accounts);
    } catch (e) {
      toast.error("Could not read accounts from Era", { description: errMsg(e) });
    } finally {
      setLoading(false);
    }
  }

  async function link(a: EraAccount) {
    const choice = pick[a.key] ?? "new";
    const type = guessType(a.type);
    const investing = type === "Investment" || type === "Retirement";
    await db.batch(async () => {
      let glId = choice;
      if (choice === "new") {
        const name =
          `${a.institution ? `${a.institution} ` : ""}${a.name}${a.mask ? ` ${a.mask}` : ""}`.trim();
        const { data, error } = await supabase
          .from("gl_accounts")
          .insert({ name, account_type: type, institution: a.institution })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        glId = data.id as string;
      }
      const { error } = await supabase.from("bank_feed_accounts").insert({
        era_account_key: a.key,
        name: a.name,
        institution: a.institution,
        mask: a.mask,
        account_type: a.type,
        gl_account_id: glId,
        balance_only: investing,
        auto_value: investing,
      });
      if (error) throw new Error(error.message);
    });
    toast.success(`${a.name} linked`, {
      description: investing
        ? "Its balance keeps its value up to date in the books."
        : "Add an opening balance in Accounts so the books start from the right number.",
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[calc(var(--screen-h)*0.9)] overflow-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bank feed accounts and rules</DialogTitle>
          <DialogDescription>
            Only the accounts linked here are read from Era, so the Spyglass business accounts stay
            out of these books.
            {settings?.bank_feed_start_date &&
              ` The feed reads from ${fmtDate(settings.bank_feed_start_date)}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="text-xs font-medium">Linked accounts</div>
        {(feeds ?? []).length ? (
          <div className="data-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Era account</th>
                  <th>In the books</th>
                  <th title="Read only the balance, not each transaction (for investment accounts)">
                    Balance only
                  </th>
                  <th title="Post the bank's balance as the account's value after each sync">
                    Keep value
                  </th>
                  <th>On</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(feeds ?? []).map((f) => (
                  <tr key={f.id}>
                    <td>
                      {f.name} {f.mask}
                      <div className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                        {f.institution}
                      </div>
                    </td>
                    <td className="min-w-[190px]">
                      <Select
                        value={f.gl_account_id ?? ""}
                        onChange={(v) =>
                          db.update("bank_feed_accounts", f.id, { gl_account_id: v || null })
                        }
                        ariaLabel="In the books"
                      >
                        <option value="">Not linked</option>
                        <AccountOptions accounts={gl} types={FEED_TYPES} keep={f.gl_account_id} />
                      </Select>
                    </td>
                    <td>
                      <Checkbox
                        checked={f.balance_only}
                        onCheckedChange={(v) =>
                          db.update("bank_feed_accounts", f.id, { balance_only: v === true })
                        }
                        aria-label="Balance only"
                      />
                    </td>
                    <td>
                      <Checkbox
                        checked={f.auto_value}
                        disabled={!["Investment", "Retirement"].includes(f.gl_account_type ?? "")}
                        onCheckedChange={(v) =>
                          db.update("bank_feed_accounts", f.id, { auto_value: v === true })
                        }
                        aria-label="Keep value from the bank"
                      />
                    </td>
                    <td>
                      <Checkbox
                        checked={f.is_active}
                        onCheckedChange={(v) =>
                          db.update("bank_feed_accounts", f.id, { is_active: v === true })
                        }
                        aria-label="Read this account"
                      />
                    </td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Remove"
                        onClick={async () => {
                          if (
                            !confirmAction(
                              "Remove this account and its transactions from the feed? Anything already in the books stays.",
                            )
                          )
                            return;
                          await db.remove("bank_feed_accounts", f.id);
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">None yet.</p>
        )}
        {eraAccounts === null ? (
          <Button
            size="sm"
            variant="outline"
            onClick={loadEra}
            disabled={loading}
            className="self-start"
          >
            {loading ? <Loader2 className="animate-spin" /> : <Plus />}
            Link an Era account
          </Button>
        ) : (
          <div className="data-scroll">
            <table className="data-table">
              <tbody>
                {eraAccounts
                  .filter((a) => !linked.has(a.key))
                  .map((a) => (
                    <tr key={a.key}>
                      <td>
                        {a.name} {a.mask}
                        <div className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                          {a.institution} · {a.type}
                          {a.balance !== null ? ` · ${money(a.balance)}` : ""}
                        </div>
                      </td>
                      <td className="min-w-[220px]">
                        <Select
                          value={pick[a.key] ?? "new"}
                          onChange={(v) => setPick((p) => ({ ...p, [a.key]: v }))}
                          ariaLabel="In the books"
                        >
                          <option value="new">New account: {TYPE_LABEL[guessType(a.type)]}</option>
                          <AccountOptions accounts={gl} types={FEED_TYPES} />
                        </Select>
                      </td>
                      <td className="text-right">
                        <Button size="sm" disabled={db.pending} onClick={() => link(a)}>
                          Link
                        </Button>
                      </td>
                    </tr>
                  ))}
                {!eraAccounts.filter((a) => !linked.has(a.key)).length && (
                  <tr>
                    <td className="text-xs text-muted-foreground">Every Era account is linked.</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-1 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
              Leave the Spyglass business accounts unlinked. Investment and retirement accounts link
              as balance only.
            </p>
          </div>
        )}

        <div className="mt-3 text-xs font-medium">Rules</div>
        {rules?.length ? (
          <div className="data-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>When it contains</th>
                  <th>Category</th>
                  <th>Project</th>
                  <th>Automatic</th>
                  <th className="numeric">Used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.contains}
                      {r.direction && (
                        <span className="ml-1 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                          (money {r.direction})
                        </span>
                      )}
                    </td>
                    <td>{glName(r.gl_account_id)}</td>
                    <td>{projects?.find((p) => p.id === r.project_id)?.name ?? ""}</td>
                    <td>
                      <Checkbox
                        checked={r.auto_add}
                        onCheckedChange={(v) =>
                          db.update("bank_rules", r.id, { auto_add: v === true })
                        }
                        aria-label="Add without asking"
                      />
                    </td>
                    <td className="text-right">{r.times_used}</td>
                    <td className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Delete rule"
                        onClick={() => db.remove("bank_rules", r.id)}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No rules yet. When you add a transaction with More, tick "Next time, suggest this" to
            make one.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

// =====================================================================================
// Entries
// =====================================================================================
function EntriesTab({ openId }: { openId?: string | undefined }) {
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(todayISO());
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const { data: entries, isLoading } = useLedgerEntries(from, to);
  const { data: payees } = usePayees();
  const { data: gl } = useGlAccounts();
  const [editing, setEditing] = useState<{ type: LedgerEntryType; entry?: LedgerEntry } | null>(
    null,
  );
  const linked = useLedgerEntry(openId);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const e = linked.data;
    if (!e || opened.current === e.id) return;
    opened.current = e.id;
    if (e.entry_date < from) setFrom(e.entry_date);
    if (e.entry_date > to) setTo(e.entry_date);
    setEditing({ type: e.entry_type, entry: e });
  }, [linked.data, from, to]);
  const payeeName = (id: string | null) => payees?.find((v) => v.id === id)?.name ?? "";
  const glName = (id: string) => {
    const a = gl?.find((x) => x.id === id);
    return a ? a.name : "";
  };
  const isMoney = (id: string) => {
    const a = gl?.find((x) => x.id === id);
    return !!a && (a.classification === "Asset" || a.classification === "Liability");
  };
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = (entries ?? []).filter(
    (e) =>
      (!kind || e.entry_type === kind) &&
      words.every((w) =>
        `${e.memo ?? ""} ${payeeName(e.payee_id)} ${e.number ?? ""} ${(e.ledger_lines ?? []).map((l) => glName(l.gl_account_id)).join(" ")} ${num(e.total).toFixed(2)}`
          .toLowerCase()
          .includes(w),
      ),
  );
  const cols: Column<LedgerEntry>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (r) => r.entry_date,
      render: (r) => fmtDate(r.entry_date),
    },
    {
      key: "type",
      header: "Type",
      sortValue: (r) => r.entry_type,
      render: (r) => (
        <span className="flex items-center gap-1.5">
          {ENTRY_KIND[r.entry_type]}
          {r.external_ref?.startsWith("era:") && <StatusPill tone="draft">Bank</StatusPill>}
        </span>
      ),
    },
    {
      key: "payee",
      header: "Payee",
      sortValue: (r) => payeeName(r.payee_id),
      render: (r) =>
        r.payee_id ? (
          <PeekName target={{ kind: "payee", id: r.payee_id }}>{payeeName(r.payee_id)}</PeekName>
        ) : null,
    },
    {
      key: "accounts",
      header: "Categories and accounts",
      render: (r) => {
        const ls = r.ledger_lines ?? [];
        const cats = ls.filter((l) => !isMoney(l.gl_account_id));
        const shown = cats.length ? cats : ls;
        return (
          <span className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
            {[...new Set(shown.map((l) => glName(l.gl_account_id)))].join(", ")}
          </span>
        );
      },
    },
    {
      key: "memo",
      header: "Memo",
      render: (r) => <span className="block max-w-[220px] truncate">{r.memo}</span>,
    },
    {
      key: "total",
      header: "Amount",
      numeric: true,
      sortValue: (r) => num(r.total),
      render: (r) =>
        r.is_void ? <StatusPill tone="void">Void</StatusPill> : <Money value={r.total} />,
    },
  ];
  return (
    <>
      <div className="toolbar">
        <Input
          type="date"
          className="w-auto"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          className="w-auto"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To"
        />
        <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Every type</option>
          {Object.entries(ENTRY_KIND).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Input
          className="h-8 w-44"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search entries"
        />
        <div className="toolbar-end ml-auto">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <Plus />
                New entry
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["expense", "deposit", "transfer", "journal", "opening"] as LedgerEntryType[]).map(
                (t) => (
                  <DropdownMenuItem key={t} onSelect={() => setEditing({ type: t })}>
                    {ENTRY_KIND[t]}
                  </DropdownMenuItem>
                ),
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <DataTable
        rows={rows}
        columns={cols}
        loading={isLoading}
        rowKey={(r) => r.id}
        initialSort={{ key: "date", dir: "desc" }}
        onRowClick={(r) => setEditing({ type: r.entry_type, entry: r })}
        empty={
          <EmptyState
            compact
            title="No entries in this period"
            description="Entries come from the bank feed, or add one by hand for cash, a check, a transfer or an opening balance."
          />
        }
        footerNote={`Total of the entries shown ${money(rows.reduce((s, r) => s + (r.is_void ? 0 : num(r.total)), 0))}`}
      />
      {editing && (
        <EntryDialog type={editing.type} entry={editing.entry} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
