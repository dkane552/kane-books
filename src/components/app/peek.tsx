// The quick-peek side panel: click a number or a name to see what is behind it without leaving the page.
// Each click inside the panel goes one step deeper; the back arrow returns.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowUpRight, ChevronRight as Chevron, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { LoadingRows, Money, StatusPill } from "./shared";
import {
  rpcRows,
  useGlAccounts,
  useLedgerEntry,
  usePayees,
  useProjects,
  useReport,
} from "@/lib/data";
import { addDays, fmtDate, num, todayISO } from "@/lib/format";
import { creditNormal, glLabel, TYPE_LABEL } from "@/lib/accounts";
import { ledgerTarget, peekKey, type PeekTarget } from "@/lib/peek";
import type { BalanceRow, GeneralLedgerRow, PnlRow } from "@/lib/types";

interface PeekApi {
  show: (t: PeekTarget) => void;
  back: () => void;
  close: () => void;
  depth: number;
}
const PeekContext = createContext<PeekApi>({
  show: () => {},
  back: () => {},
  close: () => {},
  depth: 0,
});
export const usePeek = () => useContext(PeekContext);

export function PeekProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<PeekTarget[]>([]);
  const show = useCallback(
    (t: PeekTarget) =>
      setStack((s) => (s.length && peekKey(s[s.length - 1]!) === peekKey(t) ? s : [...s, t])),
    [],
  );
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const close = useCallback(() => setStack([]), []);
  const api = useMemo(
    () => ({ show, back, close, depth: stack.length }),
    [show, back, close, stack.length],
  );
  const top = stack[stack.length - 1];
  return (
    <PeekContext.Provider value={api}>
      {children}
      <DialogPrimitive.Root open={!!top} onOpenChange={(o) => !o && close()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="peek-overlay fixed inset-0 z-50 bg-[color-mix(in_oklab,var(--overlay)_22%,transparent)]" />
          <DialogPrimitive.Content
            className="peek-panel fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-card shadow-xl sm:max-w-[30rem]"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Details</DialogPrimitive.Title>
            <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
              {stack.length > 1 && (
                <Button variant="ghost" size="sm" onClick={back} aria-label="Back">
                  <ArrowLeft />
                  Back
                </Button>
              )}
              <div className="flex-1" />
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X />
                </Button>
              </DialogPrimitive.Close>
            </div>
            <div className="flex-1 overflow-y-auto">
              {top && <PeekView key={peekKey(top)} target={top} />}
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </PeekContext.Provider>
  );
}

/** A name, number or row that opens something in the panel. */
export function PeekButton({
  target,
  children,
  className = "",
  title,
}: {
  target: PeekTarget;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const { show } = usePeek();
  return (
    <button
      type="button"
      className={`peek-link ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        show(target);
      }}
      {...(title ? { title } : {})}
    >
      {children}
    </button>
  );
}

/** A name or amount in a table that opens its detail; plain until hovered. */
export function PeekName({
  target,
  children,
  className = "",
  title,
}: {
  target: PeekTarget | undefined | null;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  if (!target) return <>{children}</>;
  return (
    <PeekButton target={target} className={`peek-name ${className}`} {...(title ? { title } : {})}>
      {children}
    </PeekButton>
  );
}

/** A summary tile that opens the panel, runs an action (such as a filter), or is plain. */
export function TileButton({
  target,
  onClick,
  active = false,
  title,
  className = "",
  children,
}: {
  target?: PeekTarget | undefined;
  onClick?: (() => void) | undefined;
  active?: boolean;
  title?: string | undefined;
  className?: string;
  children: ReactNode;
}) {
  const cls = `panel metric ${className}`;
  if (target)
    return (
      <PeekButton target={target} className={`${cls} metric-link`} {...(title ? { title } : {})}>
        {children}
      </PeekButton>
    );
  if (onClick)
    return (
      <button
        type="button"
        className={`${cls} metric-link ${active ? "metric-active" : ""}`}
        aria-pressed={active}
        onClick={onClick}
        {...(title ? { title } : {})}
      >
        {children}
      </button>
    );
  return <section className={cls}>{children}</section>;
}

function PeekView({ target }: { target: PeekTarget }) {
  switch (target.kind) {
    case "gl":
      return (
        <GlView
          id={target.id}
          {...(target.from ? { from: target.from } : {})}
          {...(target.to ? { to: target.to } : {})}
        />
      );
    case "entry":
      return <EntryView id={target.id} />;
    case "project":
      return <ProjectView id={target.id} />;
    case "payee":
      return <PayeeView id={target.id} />;
  }
}

// ---------- building blocks ----------
function Head({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-b px-5 pb-4 pt-4">
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="text-lg font-semibold leading-snug">{title}</h2>
      {children}
    </div>
  );
}
function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b px-5 py-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-[length:calc(11px*var(--ts,1))] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {meta}
      </div>
      {children}
    </section>
  );
}
function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
function Row({
  label,
  detail,
  amount,
  target,
}: {
  label: ReactNode;
  detail?: ReactNode;
  amount?: number;
  target?: PeekTarget | undefined;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{label}</span>
        {detail && (
          <span className="block text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
            {detail}
          </span>
        )}
      </span>
      {amount !== undefined && <Money value={amount} className="shrink-0 text-xs" />}
      {target && <Chevron className="size-3.5 shrink-0 text-muted-foreground" />}
    </>
  );
  const cls = "flex w-full items-center gap-3 py-2 text-left text-xs";
  return target ? (
    <PeekButton target={target} className={`${cls} peek-row`}>
      {body}
    </PeekButton>
  ) : (
    <div className={cls}>{body}</div>
  );
}
function FullPage({
  to,
  label,
  search,
}: {
  to: string;
  label: string;
  search?: Record<string, string>;
}) {
  const { close } = usePeek();
  return (
    <div className="px-5 py-4">
      <Button variant="outline" size="sm" asChild>
        <Link to={to} {...(search ? { search: search as never } : {})} onClick={close}>
          <ArrowUpRight />
          {label}
        </Link>
      </Button>
    </div>
  );
}

// ---------- an account ----------
function GlView({ id, from: givenFrom, to: givenTo }: { id: string; from?: string; to?: string }) {
  const { data: accounts } = useGlAccounts();
  const today = todayISO();
  const period = !!(givenFrom || givenTo);
  const from = givenFrom ?? addDays(today, -60);
  const to = givenTo ?? today;
  const q = useQuery({
    queryKey: ["db", "report", "report_general_ledger", "peek", id, from, to],
    queryFn: () =>
      rpcRows<GeneralLedgerRow>("report_general_ledger", { p_from: from, p_to: to, p_account: id }),
  });
  const bal = useReport<BalanceRow>("account_balances", { p_as_of: today });
  const a = accounts?.find((x) => x.id === id);
  const balance = bal.data?.find((b) => b.gl_account_id === id)?.balance;
  const all = (q.data ?? []).filter((r) => r.source !== "Beginning balance");
  const cn = creditNormal(a?.account_type);
  const signed = (r: GeneralLedgerRow) =>
    cn ? num(r.credit) - num(r.debit) : num(r.debit) - num(r.credit);
  const net = all.reduce((s, r) => s + signed(r), 0);
  const rows = all.slice().reverse().slice(0, 40);
  const isBalance = a && a.classification !== "Revenue" && a.classification !== "Expense";
  return (
    <>
      <Head eyebrow={a ? TYPE_LABEL[a.account_type] : "Account"} title={a ? glLabel(a) : "Account"}>
        {isBalance && balance != null && (
          <div className="mt-1 font-mono text-base">{<Money value={balance} />}</div>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {period
            ? `Activity from ${fmtDate(from)} to ${fmtDate(to)}, newest first.`
            : "Activity over the last 60 days, newest first."}
        </p>
      </Head>
      <Section title="Totals">
        <Facts
          rows={[
            [period ? "Net for the period" : "Net, last 60 days", <Money key="n" value={net} />],
            ["Lines", String(all.length)],
            ...(a?.tax_line ? ([["Tax line", a.tax_line]] as [ReactNode, ReactNode][]) : []),
          ]}
        />
      </Section>
      <Section title="Activity">
        {q.isLoading ? (
          <LoadingRows />
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No activity in this period.</p>
        ) : (
          rows.map((r, i) => (
            <Row
              key={`${r.source_id}-${i}`}
              label={r.party_name || r.memo || (r.entry_type ? ENTRY_KIND[r.entry_type] : r.source)}
              detail={[
                fmtDate(r.txn_date),
                r.entry_type && ENTRY_KIND[r.entry_type],
                r.project_name,
                r.party_name && r.memo,
              ]
                .filter(Boolean)
                .join(" · ")}
              amount={signed(r)}
              target={ledgerTarget(r.source, r.source_id)}
            />
          ))
        )}
        {all.length > rows.length && (
          <p className="pt-1 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
            And {all.length - rows.length} more in the general ledger.
          </p>
        )}
      </Section>
      <FullPage
        to="/reports"
        search={{ report: "General Ledger", account: id, from, to }}
        label="Open in the general ledger"
      />
    </>
  );
}

// ---------- a ledger entry ----------
export const ENTRY_KIND: Record<string, string> = {
  expense: "Expense",
  deposit: "Deposit",
  transfer: "Transfer",
  journal: "Journal entry",
  valuation: "Value update",
  opening: "Opening balance",
};
function EntryView({ id }: { id: string }) {
  const { data: accounts } = useGlAccounts();
  const { data: projects } = useProjects();
  const { data: payees } = usePayees();
  const q = useLedgerEntry(id);
  const e = q.data;
  if (q.isLoading) return <LoadingRows />;
  if (!e) return <p className="p-5 text-xs text-muted-foreground">This entry no longer exists.</p>;
  const payee = payees?.find((p) => p.id === e.payee_id);
  const lines = (e.ledger_lines ?? []).slice().sort((a, b) => a.position - b.position);
  const fromFeed = e.external_ref?.startsWith("era:");
  return (
    <>
      <Head
        eyebrow={`${ENTRY_KIND[e.entry_type] ?? "Entry"}${e.number ? ` ${e.number}` : ""}`}
        title={e.memo || payee?.name || ENTRY_KIND[e.entry_type] || "Entry"}
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span>{fmtDate(e.entry_date)}</span>
          {e.is_void && <StatusPill tone="void">Void</StatusPill>}
          {payee && (
            <>
              <span className="text-muted-foreground">·</span>
              <PeekButton
                target={{ kind: "payee", id: payee.id }}
                className="text-primary hover:underline"
              >
                {payee.name}
              </PeekButton>
            </>
          )}
          {fromFeed && <span className="text-muted-foreground">· from the bank feed</span>}
        </div>
      </Head>
      <Section title="Amount">
        <Facts rows={[["Total", <Money key="t" value={e.total} />]]} />
      </Section>
      <Section
        title="Lines"
        meta={
          <span className="text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
            {lines.length}
          </span>
        }
      >
        {lines.map((l) => {
          const a = accounts?.find((x) => x.id === l.gl_account_id);
          const p = projects?.find((x) => x.id === l.project_id);
          return (
            <Row
              key={l.id}
              label={a ? glLabel(a) : "Account"}
              detail={[num(l.debit) ? "Debit" : "Credit", l.description, p?.name, l.tax_line]
                .filter(Boolean)
                .join(" · ")}
              amount={num(l.debit) || num(l.credit)}
              target={{ kind: "gl", id: l.gl_account_id, from: e.entry_date, to: e.entry_date }}
            />
          );
        })}
      </Section>
      <FullPage
        to="/transactions"
        search={{ tab: "Entries", entry: e.id }}
        label="Edit the entry"
      />
    </>
  );
}

// ---------- a project ----------
function ProjectView({ id }: { id: string }) {
  const { data: projects } = useProjects();
  const p = projects?.find((x) => x.id === id);
  const year = new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = todayISO();
  const q = useReport<PnlRow>("report_project_detail", { p_project: id, p_from: from, p_to: to });
  const income = (q.data ?? [])
    .filter((r) => r.section.endsWith("ncome"))
    .reduce((s, r) => s + num(r.amount), 0);
  const spending = (q.data ?? [])
    .filter((r) => r.section.endsWith("pending"))
    .reduce((s, r) => s + num(r.amount), 0);
  return (
    <>
      <Head eyebrow={p?.is_business ? "Business project" : "Project"} title={p?.name ?? "Project"}>
        {p?.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}
      </Head>
      <Section title={`This year`}>
        <Facts
          rows={[
            ["Income", <Money key="i" value={income} />],
            ["Spending", <Money key="s" value={spending} />],
            ["Net", <Money key="n" value={income - spending} />],
          ]}
        />
      </Section>
      <Section title="By category">
        {q.isLoading ? (
          <LoadingRows rows={2} />
        ) : !(q.data ?? []).length ? (
          <p className="text-xs text-muted-foreground">Nothing tagged to this project this year.</p>
        ) : (
          (q.data ?? []).map((r) => (
            <Row
              key={r.gl_account_id}
              label={r.account_name}
              detail={r.section}
              amount={num(r.amount)}
              target={{ kind: "gl", id: r.gl_account_id, from, to }}
            />
          ))
        )}
      </Section>
      <FullPage to="/projects" search={{ project: id }} label="Open the project" />
    </>
  );
}

// ---------- a payee ----------
interface PayeeLine {
  txn_date: string;
  gl_account_id: string;
  account_name: string;
  project_name: string | null;
  memo: string | null;
  amount: number | string;
  source_id: string;
}
function PayeeView({ id }: { id: string }) {
  const { data: payees } = usePayees();
  const p = payees?.find((x) => x.id === id);
  const from = `${new Date().getFullYear() - 1}-01-01`;
  const q = useReport<PayeeLine>("report_payee_activity", {
    p_payee: id,
    p_from: from,
    p_to: todayISO(),
  });
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + num(r.amount), 0);
  return (
    <>
      <Head eyebrow="Payee" title={p?.name ?? "Payee"}>
        <p className="mt-1 text-xs text-muted-foreground">Since {fmtDate(from)}.</p>
      </Head>
      <Section title="Totals">
        <Facts
          rows={[
            ["Spent less received", <Money key="t" value={total} />],
            ["Lines", String(rows.length)],
          ]}
        />
      </Section>
      <Section title="Activity">
        {q.isLoading ? (
          <LoadingRows rows={2} />
        ) : !rows.length ? (
          <p className="text-xs text-muted-foreground">
            Nothing in the books for this payee since then.
          </p>
        ) : (
          rows
            .slice(0, 60)
            .map((r, i) => (
              <Row
                key={`${r.source_id}-${i}`}
                label={r.account_name}
                detail={[fmtDate(r.txn_date), r.project_name, r.memo].filter(Boolean).join(" · ")}
                amount={num(r.amount)}
                target={{ kind: "entry", id: r.source_id }}
              />
            ))
        )}
      </Section>
    </>
  );
}
