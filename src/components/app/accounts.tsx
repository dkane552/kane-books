// Accounts: balances of everything you own and owe, reconciling to statements, and the chart of accounts
// (bank and card accounts plus the income and spending categories).
import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Scale, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DataTable,
  EmptyState,
  Field,
  FormDialog,
  LoadingRows,
  LocalTabs,
  Money,
  PageHeading,
  Panel,
  Select,
  StatusPill,
  confirmAction,
} from "./shared";
import { PeekName } from "./peek";
import { ValueDialog } from "./entry-dialog";
import {
  rpc,
  useBankFeedAccounts,
  useDb,
  useGlAccounts,
  useReconciliationItems,
  useReconciliations,
  useReport,
  useSettings,
  useUncleared,
} from "@/lib/data";
import { supabase, unwrap } from "@/lib/supabase";
import {
  ALL_TYPES,
  ASSET_TYPES,
  BALANCE_TYPES,
  CATEGORY_GROUPS,
  ERA_CATEGORIES,
  FEED_TYPES,
  LIABILITY_TYPES,
  TAX_LINES,
  TYPE_LABEL,
} from "@/lib/accounts";
import { fmtDate, money, num, todayISO } from "@/lib/format";
import type {
  BalanceRow,
  GlAccount,
  GlAccountType,
  ReconciliationStatus,
  UnclearedRow,
} from "@/lib/types";
import { AccountOptions } from "./pickers";

export const ACCOUNT_TABS = ["Balances", "Reconcile", "Categories and accounts"];

export function AccountsPage({
  tab,
  onTab,
  account,
}: {
  tab: string;
  onTab: (t: string) => void;
  account?: string | undefined;
}) {
  return (
    <>
      <PageHeading
        title="Accounts"
        eyebrow="WHAT YOU OWN AND OWE"
        subtitle="Balances, reconciliations and your categories."
      />
      <Panel>
        <div className="px-3">
          <LocalTabs options={ACCOUNT_TABS} value={tab} onChange={onTab} />
        </div>
        {tab === "Reconcile" && <ReconcileTab initial={account} />}
        {tab === "Categories and accounts" && <ChartTab />}
        {tab === "Balances" && <BalancesTab />}
      </Panel>
    </>
  );
}

// =====================================================================================
// Balances
// =====================================================================================
function BalancesTab() {
  const today = todayISO();
  const { data: gl } = useGlAccounts();
  const { data: feeds } = useBankFeedAccounts();
  const bal = useReport<BalanceRow>("account_balances", { p_as_of: today });
  const [valuing, setValuing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const rows = (bal.data ?? []).filter((r) => {
    const a = gl?.find((x) => x.id === r.gl_account_id);
    return r.classification !== "Equity" && (a?.is_active || num(r.balance) !== 0);
  });
  const own = rows
    .filter((r) => r.classification === "Asset")
    .reduce((s, r) => s + num(r.balance), 0);
  const owe = rows
    .filter((r) => r.classification === "Liability")
    .reduce((s, r) => s + num(r.balance), 0);
  const types = [...ASSET_TYPES, ...LIABILITY_TYPES].filter((t) =>
    rows.some((r) => r.account_type === t),
  );
  const feedFor = (id: string) =>
    (feeds ?? []).filter((f) => f.gl_account_id === id && f.is_active);
  return (
    <>
      <div className="metrics p-4">
        {[
          ["What you own", own],
          ["What you owe", owe],
          ["Net worth", own - owe],
        ].map(([t, v]) => (
          <section key={t as string} className="panel metric">
            <div className="metric-top">
              <span>{t}</span>
            </div>
            <div className={`metric-value ${num(v as number) < 0 ? "text-destructive" : ""}`}>
              {money(v as number)}
            </div>
          </section>
        ))}
      </div>
      <div className="toolbar">
        <span className="text-xs text-muted-foreground">
          Balances in the books today. Click a name for its activity.
        </span>
        <div className="toolbar-end ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setValuing("")}>
            <TrendingUp />
            Update a value
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add an account
          </Button>
        </div>
      </div>
      {bal.isLoading ? (
        <LoadingRows />
      ) : !rows.length ? (
        <EmptyState
          compact
          title="No accounts with a balance yet"
          description="Add your bank, card, loan and investment accounts with their balances, or link them to the bank feed in Transactions."
        />
      ) : (
        <div className="data-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Bank feed</th>
                <th className="numeric">Bank says</th>
                <th className="numeric">Balance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {types.map((t) => {
                const list = rows.filter((r) => r.account_type === t);
                return [
                  <tr key={t} className="bg-muted">
                    <td colSpan={3} className="font-semibold">
                      {TYPE_LABEL[t]}
                    </td>
                    <td className="text-right font-semibold">
                      <Money value={list.reduce((s, r) => s + num(r.balance), 0)} />
                    </td>
                    <td />
                  </tr>,
                  ...list.map((r) => {
                    const a = gl?.find((x) => x.id === r.gl_account_id);
                    const f = feedFor(r.gl_account_id);
                    const bank =
                      f.length && f.some((x) => x.balance !== null)
                        ? f.reduce((s, x) => s + num(x.balance), 0)
                        : null;
                    const off = bank !== null && Math.abs(bank - num(r.balance)) > 0.004;
                    return (
                      <tr key={r.gl_account_id}>
                        <td className="pl-6">
                          <PeekName target={{ kind: "gl", id: r.gl_account_id }}>
                            {r.account_name}
                          </PeekName>
                          {a?.institution && (
                            <span className="ml-2 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                              {a.institution}
                            </span>
                          )}
                        </td>
                        <td className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                          {f.length
                            ? f.map((x) => `${x.name} ${x.mask ?? ""}`.trim()).join(", ")
                            : "Not linked"}
                        </td>
                        <td className={`text-right ${off ? "text-destructive" : ""}`}>
                          {bank === null ? "" : <Money value={bank} />}
                        </td>
                        <td className="text-right">
                          <Money value={r.balance} />
                        </td>
                        <td className="text-right">
                          {a?.is_valued && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setValuing(r.gl_account_id)}
                            >
                              Update value
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
      {valuing !== null && (
        <ValueDialog accountId={valuing || undefined} onClose={() => setValuing(null)} />
      )}
      {adding && <NewAccountDialog onClose={() => setAdding(false)} />}
    </>
  );
}

/** Add what you own or owe, with what it holds today (an opening balance against Opening balance equity). */
function NewAccountDialog({ onClose }: { onClose: () => void }) {
  const db = useDb();
  const { data: settings } = useSettings();
  const [name, setName] = useState("");
  const [type, setType] = useState<GlAccountType>("Bank");
  const [institution, setInstitution] = useState("");
  const [balance, setBalance] = useState("");
  const [asOf, setAsOf] = useState(settings?.ledger_start_date ?? todayISO());
  const owed = LIABILITY_TYPES.includes(type);
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Add an account"
      description="A bank account, card, loan, investment or something you own. The balance becomes its opening balance."
      busy={db.pending}
      onSubmit={async () => {
        if (!name.trim()) return void toast.error("Name the account");
        try {
          await db.batch(async () => {
            const [a] = unwrap(
              await supabase
                .from("gl_accounts")
                .insert({ name: name.trim(), account_type: type, institution: institution || null })
                .select(),
            ) as GlAccount[];
            const amt = Math.abs(Number(balance || 0));
            if (amt && settings?.opening_equity_gl_id) {
              await rpc("save_ledger_entry", {
                p_entry: {
                  entry_type: "opening",
                  entry_date: asOf,
                  memo: `Opening balance, ${name.trim()}`,
                },
                p_lines: [
                  {
                    gl_account_id: a!.id,
                    debit: owed ? 0 : amt,
                    credit: owed ? amt : 0,
                    position: 1,
                  },
                  {
                    gl_account_id: settings.opening_equity_gl_id,
                    debit: owed ? amt : 0,
                    credit: owed ? 0 : amt,
                    position: 2,
                  },
                ],
              });
            }
          });
          toast.success(`${name.trim()} added`);
          onClose();
        } catch {
          // shown
        }
      }}
    >
      <Field label="Name" full>
        <Input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Chase Sapphire 4417"
        />
      </Field>
      <Field label="Type">
        <Select value={type} onChange={(v) => setType(v as GlAccountType)}>
          {BALANCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Bank or company">
        <Input value={institution} onChange={(e) => setInstitution(e.target.value)} />
      </Field>
      <Field
        label={owed ? "Owed on that day" : "Balance on that day"}
        hint="Leave blank to start at zero."
      >
        <Input
          type="number"
          step="0.01"
          min="0"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
        />
      </Field>
      <Field label="As of" hint="Usually the day the books start (Settings > Books).">
        <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </Field>
    </FormDialog>
  );
}

// =====================================================================================
// Reconcile
// =====================================================================================
function ReconcileTab({ initial }: { initial?: string | undefined }) {
  const { data: gl } = useGlAccounts();
  const [accountId, setAccountId] = useState(initial ?? "");
  const account = gl?.find((a) => a.id === accountId);
  const { data: recons, isLoading } = useReconciliations(accountId || undefined);
  const db = useDb();
  const active = recons?.find((r) => r.status === "in_progress");
  const [start, setStart] = useState(false);

  useEffect(() => {
    if (!accountId && gl?.length)
      setAccountId(gl.find((a) => a.account_type === "Bank" && a.is_active)?.id ?? "");
  }, [gl, accountId]);

  return (
    <>
      <div className="toolbar">
        <select
          aria-label="Account"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">Choose an account</option>
          <AccountOptions accounts={gl} types={FEED_TYPES} keep={accountId} />
        </select>
        <div className="toolbar-end ml-auto">
          {accountId && !active && (
            <Button size="sm" onClick={() => setStart(true)}>
              <Scale />
              Reconcile a statement
            </Button>
          )}
        </div>
      </div>
      {active && account && <ReconcileWorkspace recon={active} account={account} />}
      <DataTable
        rows={recons}
        loading={isLoading}
        rowKey={(r) => r.id}
        columns={[
          { key: "date", header: "Statement date", render: (r) => fmtDate(r.statement_date) },
          {
            key: "end",
            header: "Ending balance",
            numeric: true,
            render: (r) => <Money value={r.statement_ending_balance} />,
          },
          {
            key: "status",
            header: "Status",
            render: (r) => (
              <StatusPill tone={r.status === "completed" ? "approved" : "pending"}>
                {r.status === "completed" ? "Reconciled" : "In progress"}
              </StatusPill>
            ),
          },
          {
            key: "by",
            header: "Finished",
            render: (r) => (r.completed_at ? fmtDate(r.completed_at.slice(0, 10)) : ""),
          },
          {
            key: "act",
            header: "",
            render: (r) =>
              r.status === "completed" &&
              r.id === recons?.find((x) => x.status === "completed")?.id ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirmAction("Undo this reconciliation so its items can be changed?"))
                      return;
                    await db.update("reconciliations", r.id, { status: "in_progress" });
                  }}
                >
                  Undo
                </Button>
              ) : r.status === "in_progress" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirmAction("Delete this reconciliation in progress?")) return;
                    await db.remove("reconciliations", r.id);
                  }}
                >
                  Delete
                </Button>
              ) : null,
          },
        ]}
        empty={
          <EmptyState compact title={accountId ? "No reconciliations yet" : "Choose an account"} />
        }
        footerNote="Reconciling checks the books against the statement. Reconciled items are locked until it is undone."
      />
      {start && (
        <StartReconDialog onClose={() => setStart(false)} accountId={accountId} account={account} />
      )}
    </>
  );
}

function StartReconDialog({
  onClose,
  accountId,
  account,
}: {
  onClose: () => void;
  accountId: string;
  account?: GlAccount | undefined;
}) {
  const db = useDb();
  const [date, setDate] = useState(todayISO());
  const [ending, setEnding] = useState("");
  const isAsset = account?.classification === "Asset";
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Reconcile ${account ? account.name : ""}`}
      description={
        isAsset
          ? "Enter the ending balance printed on the statement."
          : "Enter the balance owed printed on the statement."
      }
      submitLabel="Start"
      busy={db.pending}
      onSubmit={async () => {
        await db.insert("reconciliations", {
          gl_account_id: accountId,
          statement_date: date,
          statement_ending_balance: Number(ending || 0),
        });
        onClose();
      }}
    >
      <Field label="Statement date">
        <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label={isAsset ? "Ending balance" : "Balance owed"}>
        <Input
          type="number"
          step="0.01"
          required
          value={ending}
          onChange={(e) => setEnding(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

function ReconcileWorkspace({
  recon,
  account,
}: {
  recon: ReconciliationStatus;
  account: GlAccount;
}) {
  const db = useDb();
  const { data: uncleared, isLoading } = useUncleared(account.id, recon.statement_date);
  const { data: items } = useReconciliationItems(recon.id);
  const [clearedRows, setClearedRows] = useState<UnclearedRow[]>([]);
  const sign = account.classification === "Asset" ? 1 : -1;

  useEffect(() => {
    const ids = (items ?? []).map((i) => i.source_id);
    if (!ids.length) return void setClearedRows([]);
    supabase
      .from("v_gl")
      .select(
        "source, source_id, txn_date, doc_number, party_name, memo, amount, gl_account_id, account_name",
      )
      .eq("gl_account_id", account.id)
      .in("source_id", ids)
      .then(({ data }) => {
        const m = new Map<string, UnclearedRow>();
        for (const r of (data ?? []) as UnclearedRow[]) {
          const k = `${r.source}:${r.source_id}`;
          const prev = m.get(k);
          m.set(k, prev ? { ...prev, amount: num(prev.amount) + num(r.amount) } : r);
        }
        setClearedRows([...m.values()]);
      });
  }, [items, account.id]);

  const rows = useMemo(
    () =>
      [...clearedRows, ...(uncleared ?? [])].sort((a, b) => a.txn_date.localeCompare(b.txn_date)),
    [clearedRows, uncleared],
  );
  const cleared = new Set((items ?? []).map((i) => `${i.source}:${i.source_id}`));
  const clearedNet = clearedRows.reduce((s, r) => s + sign * num(r.amount), 0);
  const difference =
    num(recon.statement_ending_balance) - (num(recon.beginning_balance) + clearedNet);

  async function toggle(r: UnclearedRow) {
    const key = `${r.source}:${r.source_id}`;
    await db.batch(async () => {
      if (cleared.has(key))
        unwrap(
          await supabase
            .from("reconciliation_items")
            .delete()
            .eq("reconciliation_id", recon.id)
            .eq("source", r.source)
            .eq("source_id", r.source_id),
        );
      else
        unwrap(
          await supabase.from("reconciliation_items").insert({
            reconciliation_id: recon.id,
            gl_account_id: account.id,
            source: r.source,
            source_id: r.source_id,
          }),
        );
    });
  }

  async function clearAll() {
    const todo = (uncleared ?? []).filter((r) => !cleared.has(`${r.source}:${r.source_id}`));
    if (!todo.length) return;
    await db.batch(async () =>
      unwrap(
        await supabase.from("reconciliation_items").insert(
          todo.map((r) => ({
            reconciliation_id: recon.id,
            gl_account_id: account.id,
            source: r.source,
            source_id: r.source_id,
          })),
        ),
      ),
    );
  }

  return (
    <div className="border-b p-4">
      <div className="metrics mb-3">
        {[
          ["Statement date", fmtDate(recon.statement_date)],
          ["Beginning balance", money(recon.beginning_balance)],
          ["Cleared", money(clearedNet)],
          ["Statement ending", money(recon.statement_ending_balance)],
          ["Difference", money(difference)],
        ].map(([t, v]) => (
          <section key={t} className="panel metric">
            <div className="metric-top">
              <span>{t}</span>
            </div>
            <div
              className={`metric-value ${t === "Difference" && Math.abs(difference) > 0.004 ? "text-destructive" : ""}`}
            >
              {v}
            </div>
          </section>
        ))}
      </div>
      {isLoading ? (
        <LoadingRows />
      ) : (
        <div className="data-scroll max-h-[420px]">
          <table className="data-table">
            <thead>
              <tr>
                <th />
                <th>Date</th>
                <th>Name</th>
                <th>Memo</th>
                <th className="numeric">
                  {account.classification === "Asset" ? "Deposits" : "Payments"}
                </th>
                <th className="numeric">
                  {account.classification === "Asset" ? "Withdrawals" : "Charges"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const effect = sign * num(r.amount);
                const up = effect > 0;
                return (
                  <tr
                    key={`${r.source}:${r.source_id}`}
                    className="cursor-pointer hover:bg-muted/60"
                    onClick={() => toggle(r)}
                  >
                    <td>
                      <Checkbox
                        checked={cleared.has(`${r.source}:${r.source_id}`)}
                        aria-label="Cleared"
                      />
                    </td>
                    <td>{fmtDate(r.txn_date)}</td>
                    <td>
                      <PeekName target={{ kind: "entry", id: r.source_id }}>
                        {r.party_name || "Entry"}
                      </PeekName>
                    </td>
                    <td className="max-w-[220px] truncate">{r.memo}</td>
                    <td className="text-right">
                      {(account.classification === "Asset" ? up : !up) && (
                        <Money value={Math.abs(effect)} />
                      )}
                    </td>
                    <td className="text-right">
                      {(account.classification === "Asset" ? !up : up) && (
                        <Money value={Math.abs(effect)} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="outline" disabled={db.pending} onClick={clearAll}>
          Tick everything through the statement date
        </Button>
        <Button
          disabled={Math.abs(difference) > 0.004 || db.pending}
          onClick={async () => {
            await db.update("reconciliations", recon.id, { status: "completed" });
            toast.success("Reconciled");
          }}
        >
          {db.pending && <Loader2 className="animate-spin" />}
          Finish reconciliation
        </Button>
      </div>
    </div>
  );
}

// =====================================================================================
// Categories and accounts (the chart)
// =====================================================================================
function ChartTab() {
  const { data: gl, isLoading } = useGlAccounts();
  const bal = useReport<BalanceRow>("account_balances", { p_as_of: todayISO() });
  const [editing, setEditing] = useState<GlAccount | "new" | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [kind, setKind] = useState("");
  const rows = (gl ?? []).filter(
    (a) =>
      (showInactive || a.is_active) &&
      (!kind ||
        (kind === "categories"
          ? ["Revenue", "Expense"].includes(a.classification)
          : !["Revenue", "Expense"].includes(a.classification))),
  );
  return (
    <>
      <div className="toolbar">
        <select aria-label="Show" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">Everything</option>
          <option value="categories">Income and spending categories</option>
          <option value="accounts">Accounts you own or owe, and net worth</option>
        </select>
        <label className="flex items-center gap-2 text-xs">
          <Checkbox checked={showInactive} onCheckedChange={(v) => setShowInactive(v === true)} />
          Show inactive
        </label>
        <div className="toolbar-end ml-auto">
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus />
            New category or account
          </Button>
        </div>
      </div>
      <DataTable
        rows={rows}
        loading={isLoading}
        rowKey={(r) => r.id}
        onRowClick={(r) => setEditing(r)}
        initialSort={{ key: "type", dir: "asc" }}
        columns={[
          {
            key: "num",
            header: "#",
            sortValue: (r) => r.number ?? "~",
            render: (r) => <span className="number">{r.number}</span>,
          },
          {
            key: "name",
            header: "Name",
            sortValue: (r) => r.name,
            render: (r) => (
              <span className={r.is_active ? "" : "text-muted-foreground line-through"}>
                {r.name}
              </span>
            ),
          },
          {
            key: "type",
            header: "Type",
            sortValue: (r) =>
              `${String(ALL_TYPES.indexOf(r.account_type)).padStart(2, "0")}${r.category_group ?? ""}${r.number ?? "~"}${r.name}`,
            render: (r) => TYPE_LABEL[r.account_type],
          },
          {
            key: "group",
            header: "Group",
            sortValue: (r) => r.category_group ?? "",
            render: (r) => r.category_group,
          },
          {
            key: "tax",
            header: "Tax line",
            render: (r) => (
              <span className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                {r.tax_line}
              </span>
            ),
          },
          {
            key: "bal",
            header: "Balance today",
            numeric: true,
            render: (r) => {
              const b = bal.data?.find((x) => x.gl_account_id === r.id);
              return b ? (
                <PeekName target={{ kind: "gl", id: r.id }}>
                  <Money value={b.balance} blankZero />
                </PeekName>
              ) : null;
            },
          },
        ]}
        empty={<EmptyState compact title="Nothing here" />}
        footerNote="Categories and accounts are switched off, never deleted, so history stays."
      />
      {editing && (
        <GlAccountDialog
          account={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function GlAccountDialog({
  account,
  onClose,
}: {
  account?: GlAccount | undefined;
  onClose: () => void;
}) {
  const db = useDb();
  const [f, setF] = useState({
    number: account?.number ?? "",
    name: account?.name ?? "",
    account_type: account?.account_type ?? ("Expense" as GlAccountType),
    category_group: account?.category_group ?? "",
    tax_line: account?.tax_line ?? "",
    era_category: account?.era_category ?? "",
    era_auto: account?.era_auto ?? false,
    institution: account?.institution ?? "",
    description: account?.description ?? "",
    is_active: account?.is_active ?? true,
  });
  const isCategory = ["Income", "Expense", "Other Income", "Other Expense"].includes(
    f.account_type,
  );
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={account ? `Edit ${account.name}` : "New category or account"}
      busy={db.pending}
      onSubmit={async () => {
        if (!f.name.trim()) return void toast.error("Name is required");
        const values = {
          number: f.number.trim() || null,
          name: f.name.trim(),
          account_type: f.account_type,
          category_group: isCategory ? f.category_group || null : null,
          tax_line: f.tax_line || null,
          era_category: isCategory ? f.era_category || null : null,
          era_auto: isCategory && f.era_category ? f.era_auto : null,
          institution: isCategory ? null : f.institution || null,
          description: f.description || null,
          is_active: f.is_active,
        };
        if (account) await db.update("gl_accounts", account.id, values);
        else await db.insert("gl_accounts", values);
        // Refill the bank feed when the Era match changed.
        if (
          (account?.era_category ?? null) !== values.era_category ||
          (account?.era_auto ?? null) !== values.era_auto
        )
          await db.batch(() => rpc("bank_autoprocess", {}));
        onClose();
      }}
    >
      <Field label="Name" full>
        <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </Field>
      <Field label="Type">
        <Select
          value={f.account_type}
          onChange={(v) => setF({ ...f, account_type: v as GlAccountType })}
        >
          {ALL_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Number" hint="Optional; sorts the lists.">
        <Input
          value={f.number}
          onChange={(e) => setF({ ...f, number: e.target.value })}
          placeholder="5240"
        />
      </Field>
      {isCategory ? (
        <Field label="Group" hint="Budgets and reports total by group.">
          <Input
            list="kb-groups"
            value={f.category_group}
            onChange={(e) => setF({ ...f, category_group: e.target.value })}
          />
          <datalist id="kb-groups">
            {CATEGORY_GROUPS.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
        </Field>
      ) : (
        <Field label="Bank or company">
          <Input
            value={f.institution}
            onChange={(e) => setF({ ...f, institution: e.target.value })}
          />
        </Field>
      )}
      {isCategory && (
        <Field label="Era category" hint="Bank transactions Era tags this way get this category.">
          <Select value={f.era_category} onChange={(v) => setF({ ...f, era_category: v })}>
            <option value="">None</option>
            {[...new Set([...ERA_CATEGORIES, ...(f.era_category ? [f.era_category] : [])])].map(
              (c) => (
                <option key={c}>{c}</option>
              ),
            )}
          </Select>
          {f.era_category && (
            <label className="mt-1 flex items-center gap-2 text-xs">
              <Checkbox
                checked={f.era_auto}
                onCheckedChange={(v) => setF({ ...f, era_auto: v === true })}
              />
              Add these automatically (off: they wait for you, with Era&apos;s guess shown)
            </label>
          )}
        </Field>
      )}
      <Field label="Tax line" hint="Puts it on the tax summary for your CPA.">
        <Select value={f.tax_line} onChange={(v) => setF({ ...f, tax_line: v })}>
          <option value="">None</option>
          {[...new Set([...TAX_LINES, ...(f.tax_line ? [f.tax_line] : [])])].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" full>
        <Input
          value={f.description}
          onChange={(e) => setF({ ...f, description: e.target.value })}
        />
      </Field>
      <label className="field flex-row items-center gap-2">
        <Checkbox
          checked={f.is_active}
          onCheckedChange={(v) => setF({ ...f, is_active: v === true })}
        />
        Active
      </label>
    </FormDialog>
  );
}
