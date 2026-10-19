import { useEffect, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  EmptyState,
  Field,
  LoadingRows,
  PageHeading,
  Panel,
  Select,
  confirmAction,
} from "./shared";
import { AccountOptions } from "./pickers";
import { PeekName, usePeek } from "./peek";
import { BackupsPanel } from "./backups";
import { SecurityPanel } from "./security";
import { AccessibilityPanel } from "./display-settings";
import {
  useAuditLog,
  useDb,
  useGlAccounts,
  useLedgerExceptions,
  usePayees,
  useSettings,
} from "@/lib/data";
import { fmtDate, money, num } from "@/lib/format";
import type { GlAccountType } from "@/lib/types";

const TABS = ["Books", "Payees", "Security", "Accessibility", "Backups"] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const { tab: fromUrl } = useSearch({ from: "/settings" });
  const [tab, setTab] = useState<Tab>(() =>
    (TABS as readonly string[]).includes(fromUrl ?? "") ? (fromUrl as Tab) : "Books",
  );
  useEffect(() => {
    if ((TABS as readonly string[]).includes(fromUrl ?? "")) setTab(fromUrl as Tab);
  }, [fromUrl]);
  return (
    <>
      <PageHeading
        title="Settings"
        eyebrow="KANE BOOKS"
        subtitle="How the books are set up, who you pay, and keeping it all safe."
      />
      <div className="settings-layout">
        <nav className="settings-menu" aria-label="Settings sections">
          {TABS.map((x) => (
            <Button
              variant="ghost"
              key={x}
              className="tab-link"
              data-active={tab === x}
              onClick={() => setTab(x)}
            >
              {x}
            </Button>
          ))}
        </nav>
        <div>
          {tab === "Books" && <BooksPanel />}
          {tab === "Payees" && <PayeesPanel />}
          {tab === "Security" && <SecurityPanel />}
          {tab === "Accessibility" && <AccessibilityPanel />}
          {tab === "Backups" && <BackupsPanel />}
        </div>
      </div>
    </>
  );
}

const LINKS: { key: string; label: string; types: GlAccountType[]; hint?: string }[] = [
  {
    key: "default_cash_gl_id",
    label: "Main checking account",
    types: ["Bank"],
    hint: "New expenses and deposits start from this account.",
  },
  { key: "opening_equity_gl_id", label: "Opening balances go to", types: ["Equity"] },
  {
    key: "net_worth_carried_gl_id",
    label: "Past years' savings go to",
    types: ["Equity"],
    hint: "Where each year's net closes on the net worth statement.",
  },
  {
    key: "value_change_gl_id",
    label: "Value changes go to",
    types: ["Other Income", "Income"],
    hint: "Gains and losses from value updates on investments, property and vehicles.",
  },
  { key: "uncategorized_expense_gl_id", label: "Uncategorized spending", types: ["Expense"] },
  { key: "uncategorized_income_gl_id", label: "Uncategorized income", types: ["Income"] },
];

function BooksPanel() {
  const { data: settings } = useSettings();
  const { data: gl } = useGlAccounts();
  const { data: exceptions } = useLedgerExceptions();
  const { data: audit } = useAuditLog(60);
  const db = useDb();
  const { show } = usePeek();
  const [f, setF] = useState<Record<string, string>>({});
  const [closeDate, setCloseDate] = useState("");

  useEffect(() => {
    if (!settings) return;
    const c = settings as unknown as Record<string, unknown>;
    const next: Record<string, string> = {
      owner_name: String(c["owner_name"] ?? ""),
      ledger_start_date: String(c["ledger_start_date"] ?? ""),
      bank_feed_start_date: String(c["bank_feed_start_date"] ?? ""),
      fiscal_year_start_month: String(c["fiscal_year_start_month"] ?? 1),
    };
    for (const l of LINKS) next[l.key] = String(c[l.key] ?? "");
    setF(next);
    setCloseDate(settings.books_closed_through ?? "");
  }, [settings]);

  return (
    <div className="stack">
      <Panel title="The books">
        <div className="form-grid">
          <Field label="Your name" hint="On reports and the tax pack.">
            <Input
              value={f["owner_name"] ?? ""}
              onChange={(e) => setF({ ...f, owner_name: e.target.value })}
            />
          </Field>
          <Field
            label="Books start on"
            hint="Nothing dated earlier counts. Enter opening balances dated this day."
          >
            <Input
              type="date"
              value={f["ledger_start_date"] ?? ""}
              onChange={(e) => setF({ ...f, ledger_start_date: e.target.value })}
            />
          </Field>
          <Field
            label="Bank feed reads from"
            hint="The first sync of a newly linked account goes back to this day."
          >
            <Input
              type="date"
              value={f["bank_feed_start_date"] ?? ""}
              onChange={(e) => setF({ ...f, bank_feed_start_date: e.target.value })}
            />
          </Field>
          <Field label="Year starts in">
            <Select
              value={f["fiscal_year_start_month"] ?? "1"}
              onChange={(v) => setF({ ...f, fiscal_year_start_month: v })}
            >
              {[
                "January",
                "February",
                "March",
                "April",
                "May",
                "June",
                "July",
                "August",
                "September",
                "October",
                "November",
                "December",
              ].map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
          {LINKS.map((l) => (
            <Field key={l.key} label={l.label} {...(l.hint ? { hint: l.hint } : {})}>
              <Select value={f[l.key] ?? ""} onChange={(v) => setF({ ...f, [l.key]: v })}>
                <option value="">None</option>
                <AccountOptions accounts={gl} types={l.types} keep={f[l.key]} />
              </Select>
            </Field>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4">
          <Button
            disabled={db.pending}
            onClick={async () => {
              const values: Record<string, unknown> = {
                owner_name: f["owner_name"] || "Me",
                ledger_start_date: f["ledger_start_date"] || null,
                bank_feed_start_date: f["bank_feed_start_date"] || null,
                fiscal_year_start_month: Number(f["fiscal_year_start_month"] || 1),
              };
              for (const l of LINKS) values[l.key] = f[l.key] || null;
              await db.update("book_settings", "1", values);
              toast.success("Settings saved");
            }}
          >
            Save
          </Button>
        </div>
      </Panel>

      <Panel title="Close the books">
        <div className="flex flex-wrap items-end gap-3 p-5">
          <Field label="Closed through">
            <Input type="date" value={closeDate} onChange={(e) => setCloseDate(e.target.value)} />
          </Field>
          <Button
            disabled={!closeDate || db.pending}
            onClick={async () => {
              if (
                !confirmAction(`Lock every transaction dated on or before ${fmtDate(closeDate)}?`)
              )
                return;
              await db.update("book_settings", "1", { books_closed_through: closeDate });
              toast.success("Books closed");
            }}
          >
            Close
          </Button>
          {settings?.books_closed_through && (
            <Button
              variant="outline"
              disabled={db.pending}
              onClick={async () => {
                if (
                  !confirmAction(
                    "Reopen the books? Anything in the closed period can be changed again until you close it.",
                  )
                )
                  return;
                await db.update("book_settings", "1", { books_closed_through: null });
              }}
            >
              Reopen
            </Button>
          )}
          <p className="basis-full text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
            Close a month once its accounts are reconciled, and close the year before sending the
            tax pack. While closed, nothing dated in the period can be added, changed or deleted.
          </p>
        </div>
      </Panel>

      <Panel title="Entries that do not balance" meta={exceptions?.length ?? 0}>
        {!exceptions?.length ? (
          <p className="p-5 text-xs text-muted-foreground">None. Every entry balances.</p>
        ) : (
          <ul className="divide-y text-xs">
            {exceptions.map((e) => (
              <li key={e.source_id}>
                <button
                  type="button"
                  className="flex w-full gap-3 px-5 py-2 text-left hover:bg-muted/60"
                  onClick={() => show({ kind: "entry", id: e.source_id })}
                >
                  <span className="w-24">{fmtDate(e.txn_date)}</span>
                  <span className="flex-1">
                    {e.problem} by {money(e.out_of_balance)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Audit log" meta="latest 60">
        <div className="data-scroll max-h-[360px]">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Changed</th>
              </tr>
            </thead>
            <tbody>
              {audit?.map((a) => {
                const changed =
                  a.op === "UPDATE" && a.old_row && a.new_row
                    ? Object.keys(a.new_row).filter(
                        (k) =>
                          k !== "updated_at" &&
                          JSON.stringify(a.new_row![k]) !== JSON.stringify(a.old_row![k]),
                      )
                    : [];
                const entry = a.op !== "DELETE" && a.table_name === "ledger_entries" && a.row_id;
                return (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{new Date(a.at).toLocaleString("en-US")}</td>
                    <td>
                      {entry ? (
                        <PeekName target={{ kind: "entry", id: a.row_id! }}>
                          {a.op === "INSERT" ? "Added" : "Changed"} an entry
                        </PeekName>
                      ) : (
                        <>
                          {a.op === "INSERT" ? "Added" : a.op === "UPDATE" ? "Changed" : "Deleted"}{" "}
                          {a.table_name.replace(/_/g, " ")}
                        </>
                      )}
                    </td>
                    <td className="max-w-[360px] truncate text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
                      {changed
                        .map(
                          (k) =>
                            `${k}: ${String(a.old_row![k] ?? "")} to ${String(a.new_row![k] ?? "")}`,
                        )
                        .join("; ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function PayeesPanel() {
  const { data: payees, isLoading } = usePayees();
  const db = useDb();
  const [name, setName] = useState("");
  const [filter, setFilter] = useState("");
  const list = (payees ?? []).filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Panel title="Payees" meta={payees?.length ?? 0}>
      <div className="toolbar">
        <Input
          className="h-8 w-48"
          placeholder="Search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Search payees"
        />
        <div className="toolbar-end ml-auto flex gap-2">
          <Input
            className="h-8 w-48"
            placeholder="New payee"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="New payee name"
          />
          <Button
            size="sm"
            disabled={!name.trim() || db.pending}
            onClick={async () => {
              await db.insert("payees", { name: name.trim() });
              setName("");
            }}
          >
            Add
          </Button>
        </div>
      </div>
      {isLoading ? (
        <LoadingRows />
      ) : !list.length ? (
        <EmptyState
          compact
          title="No payees"
          description="Payees are added as you name them on transactions."
        />
      ) : (
        <ul className="divide-y text-xs">
          {list.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-1.5">
              <span className="flex-1">
                <PeekName target={{ kind: "payee", id: p.id }}>{p.name}</PeekName>
              </span>
              <label className="flex items-center gap-1.5 text-muted-foreground">
                <Checkbox
                  checked={p.is_active}
                  onCheckedChange={(v) => db.update("payees", p.id, { is_active: v === true })}
                />
                In the list
              </label>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${p.name}`}
                onClick={async () => {
                  if (
                    !confirmAction(
                      `Delete ${p.name}? Entries keep their amounts but lose the payee.`,
                    )
                  )
                    return;
                  await db.remove("payees", p.id);
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="px-5 pb-4 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
        {num(payees?.length)} payees. Untick one to hide it from the pickers without losing its
        history.
      </p>
    </Panel>
  );
}
