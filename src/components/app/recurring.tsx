// Recurring: bills, subscriptions and paychecks that repeat, found in the bank activity or added by hand.
// Schema: recurring_bills, v_recurring_bills and recurring_candidates() in supabase/4_personal.sql.
import { useState } from "react";
import { Plus, Repeat, X } from "lucide-react";
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
  Money,
  PageHeading,
  Panel,
  Select,
  StatusPill,
  confirmAction,
} from "./shared";
import { AccountOptions, PayeeInput } from "./pickers";
import { payeeId } from "./entry-dialog";
import {
  useBankFeedAccounts,
  useDb,
  useGlAccounts,
  usePayees,
  useRecurringBills,
  useReport,
} from "@/lib/data";
import { CATEGORY_TYPES } from "@/lib/accounts";
import { supabase, unwrap } from "@/lib/supabase";
import { fmtDate, money, num } from "@/lib/format";
import type { Cadence, RecurringBill, RecurringCandidate } from "@/lib/types";

const CADENCE: Record<Cadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semimonthly: "Twice a month",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};
const STATE_TONE: Record<
  RecurringBill["state"],
  "approved" | "pending" | "draft" | "denied" | "void"
> = {
  late: "denied",
  "due soon": "pending",
  upcoming: "approved",
  unknown: "draft",
  paused: "void",
};

export function RecurringPage() {
  const { data: bills, isLoading } = useRecurringBills();
  const found = useReport<RecurringCandidate>("recurring_candidates", {});
  const db = useDb();
  const [editing, setEditing] = useState<Partial<RecurringBill> | null>(null);
  const active = (bills ?? []).filter((b) => b.is_active);
  const perMonthOut = active
    .filter((b) => !b.is_income)
    .reduce((s, b) => s + num(b.monthly_amount), 0);
  const perMonthIn = active
    .filter((b) => b.is_income)
    .reduce((s, b) => s + num(b.monthly_amount), 0);
  const late = active.filter((b) => b.state === "late").length;
  return (
    <>
      <PageHeading
        title="Recurring"
        eyebrow="BILLS AND PAYCHECKS"
        subtitle="What repeats, when it is next due, and what it costs a month."
      >
        <Button
          size="sm"
          onClick={() =>
            setEditing({ cadence: "monthly", autopay: true, is_active: true, is_income: false })
          }
        >
          <Plus />
          Add a bill
        </Button>
      </PageHeading>
      <div className="metrics">
        {[
          ["Bills a month", perMonthOut, `${active.filter((b) => !b.is_income).length} going out`],
          [
            "Coming in a month",
            perMonthIn,
            `${active.filter((b) => b.is_income).length} coming in`,
          ],
          ["A year of bills", perMonthOut * 12, "At today's amounts"],
          ["Late", late, "Expected but not seen", true],
        ].map(([t, v, foot, count]) => (
          <section key={t as string} className="panel metric">
            <div className="metric-top">
              <span>{t}</span>
            </div>
            <div
              className={`metric-value ${count && num(v as number) > 0 ? "text-destructive" : ""}`}
            >
              {count ? String(v) : money(v as number)}
            </div>
            <div className="metric-foot">
              <span>{foot}</span>
            </div>
          </section>
        ))}
      </div>
      <Panel title="Recurring" meta={active.length}>
        <DataTable
          rows={bills}
          loading={isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => setEditing(r)}
          initialSort={{ key: "next", dir: "asc" }}
          columns={[
            {
              key: "name",
              header: "Name",
              sortValue: (r) => r.name,
              render: (r) => (
                <span className={r.is_active ? "" : "text-muted-foreground line-through"}>
                  {r.name}
                  {r.is_income && (
                    <span className="ml-2 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                      income
                    </span>
                  )}
                </span>
              ),
            },
            {
              key: "cat",
              header: "Category",
              sortValue: (r) => r.account_name ?? "",
              render: (r) => r.account_name,
            },
            { key: "cad", header: "How often", render: (r) => CADENCE[r.cadence] },
            {
              key: "amt",
              header: "Amount",
              numeric: true,
              sortValue: (r) => num(r.amount),
              render: (r) => <Money value={r.is_income ? r.amount : -num(r.amount)} />,
            },
            {
              key: "last",
              header: "Last seen",
              sortValue: (r) => r.last_seen ?? "",
              render: (r) =>
                r.last_seen ? (
                  <span>
                    {fmtDate(r.last_seen)}
                    {num(r.last_amount) > 0 &&
                    Math.abs(num(r.last_amount) - num(r.amount)) > 0.009 ? (
                      <span className="ml-1 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                        ({money(r.last_amount)})
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not found yet</span>
                ),
            },
            {
              key: "next",
              header: "Next",
              sortValue: (r) => (r.is_active ? (r.next_expected ?? "9999") : "99999"),
              render: (r) => (r.next_expected ? fmtDate(r.next_expected) : ""),
            },
            {
              key: "state",
              header: "",
              render: (r) => (
                <StatusPill tone={STATE_TONE[r.state]}>
                  {r.state === "upcoming" ? "On track" : r.state}
                </StatusPill>
              ),
            },
            {
              key: "month",
              header: "A month",
              numeric: true,
              sortValue: (r) => num(r.monthly_amount),
              render: (r) => <Money value={r.monthly_amount} />,
            },
          ]}
          empty={
            <EmptyState
              compact
              icon={Repeat}
              title="No recurring bills yet"
              description="Add the ones found below, or add a bill by hand."
            />
          }
          footerNote="A bill is matched to bank transactions by its matching text. Late means it was expected over 5 days ago and has not come through."
        />
      </Panel>
      <div className="h-6" />
      <Panel title="Found in your bank activity" meta={found.data?.length ?? 0}>
        {found.isLoading ? (
          <LoadingRows rows={2} />
        ) : !(found.data ?? []).length ? (
          <EmptyState
            compact
            title="Nothing new found"
            description="Charges that repeat at least three times on a steady schedule show here."
          />
        ) : (
          <div className="data-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Looks like</th>
                  <th>How often</th>
                  <th className="numeric">Times</th>
                  <th className="numeric">Amount</th>
                  <th>Last</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(found.data ?? []).map((c) => (
                  <tr key={`${c.merchant_key}-${c.is_income}`}>
                    <td>
                      {c.sample}
                      {c.is_income && (
                        <span className="ml-2 text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                          income
                        </span>
                      )}
                    </td>
                    <td>{CADENCE[c.cadence]}</td>
                    <td className="text-right">{c.times}</td>
                    <td className="text-right">
                      <Money value={c.is_income ? c.last_amount : -num(c.last_amount)} />
                      {num(c.min_amount) !== num(c.max_amount) && (
                        <div className="text-[length:calc(10px*var(--ts,1))] text-muted-foreground">
                          {money(c.min_amount)} to {money(c.max_amount)}
                        </div>
                      )}
                    </td>
                    <td>{fmtDate(c.last_seen)}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          onClick={() =>
                            setEditing({
                              name: titleCase(c.sample),
                              amount: num(c.last_amount),
                              cadence: c.cadence,
                              match_text: c.merchant_key,
                              is_income: c.is_income,
                              gl_account_id: c.gl_account_id,
                              feed_account_id: c.feed_account_id,
                              autopay: true,
                              is_active: true,
                            })
                          }
                        >
                          Add
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Not a recurring bill"
                          title="Not a recurring bill"
                          onClick={() =>
                            db.insert("recurring_dismissed", { merchant_key: c.merchant_key })
                          }
                        >
                          <X />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {editing && <BillDialog bill={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .slice(0, 40);

function BillDialog({ bill, onClose }: { bill: Partial<RecurringBill>; onClose: () => void }) {
  const db = useDb();
  const { data: gl } = useGlAccounts();
  const { data: payees } = usePayees();
  const { data: feeds } = useBankFeedAccounts();
  const [f, setF] = useState({
    name: bill.name ?? "",
    is_income: bill.is_income ?? false,
    gl_account_id: bill.gl_account_id ?? "",
    amount: bill.amount !== undefined && bill.amount !== null ? String(num(bill.amount)) : "",
    cadence: (bill.cadence ?? "monthly") as Cadence,
    match_text: bill.match_text ?? "",
    feed_account_id: bill.feed_account_id ?? "",
    next_due: bill.next_due ?? "",
    autopay: bill.autopay ?? true,
    is_active: bill.is_active ?? true,
    notes: bill.notes ?? "",
  });
  const [payee, setPayee] = useState(payees?.find((p) => p.id === bill.payee_id)?.name ?? "");
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={bill.id ? `Edit ${bill.name}` : "Add a recurring bill"}
      busy={db.pending}
      footerLeft={
        bill.id && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={async () => {
              if (!confirmAction("Delete this recurring bill? Nothing in the books changes."))
                return;
              await db.remove("recurring_bills", bill.id!);
              onClose();
            }}
          >
            Delete
          </Button>
        )
      }
      onSubmit={async () => {
        if (!f.name.trim()) return void toast.error("Name it");
        try {
          await db.batch(async () => {
            const values = {
              name: f.name.trim(),
              is_income: f.is_income,
              payee_id: await payeeId(payee),
              gl_account_id: f.gl_account_id || null,
              amount: Math.abs(Number(f.amount || 0)),
              cadence: f.cadence,
              match_text: f.match_text.trim() || null,
              feed_account_id: f.feed_account_id || null,
              next_due: f.next_due || null,
              autopay: f.autopay,
              is_active: f.is_active,
              notes: f.notes || null,
            };
            if (bill.id)
              unwrap(await supabase.from("recurring_bills").update(values).eq("id", bill.id));
            else unwrap(await supabase.from("recurring_bills").insert(values));
          });
          onClose();
        } catch {
          // shown
        }
      }}
    >
      <Field label="Name" full>
        <Input
          required
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          placeholder="Netflix"
        />
      </Field>
      <Field label="Amount">
        <Input
          type="number"
          step="0.01"
          min="0"
          required
          value={f.amount}
          onChange={(e) => setF({ ...f, amount: e.target.value })}
        />
      </Field>
      <Field label="How often">
        <Select value={f.cadence} onChange={(v) => setF({ ...f, cadence: v as Cadence })}>
          {Object.entries(CADENCE).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Category">
        <Select value={f.gl_account_id} onChange={(v) => setF({ ...f, gl_account_id: v })}>
          <option value="">None</option>
          <AccountOptions accounts={gl} types={CATEGORY_TYPES} keep={f.gl_account_id} />
        </Select>
      </Field>
      <Field label="Payee">
        <PayeeInput value={payee} onChange={setPayee} />
      </Field>
      <Field label="Matching text" hint="Bank transactions containing this are this bill.">
        <Input
          value={f.match_text}
          onChange={(e) => setF({ ...f, match_text: e.target.value })}
          placeholder="NETFLIX"
        />
      </Field>
      <Field label="Only from account">
        <Select value={f.feed_account_id} onChange={(v) => setF({ ...f, feed_account_id: v })}>
          <option value="">Any account</option>
          {(feeds ?? []).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} {x.mask ?? ""}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Next due" hint="Leave blank to work it out from the last payment.">
        <Input
          type="date"
          value={f.next_due}
          onChange={(e) => setF({ ...f, next_due: e.target.value })}
        />
      </Field>
      <Field label="Notes">
        <Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <div className="full col-span-2 flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={f.is_income}
            onCheckedChange={(v) => setF({ ...f, is_income: v === true })}
          />
          Money coming in (a paycheck or deposit)
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={f.autopay}
            onCheckedChange={(v) => setF({ ...f, autopay: v === true })}
          />
          Paid automatically
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={f.is_active}
            onCheckedChange={(v) => setF({ ...f, is_active: v === true })}
          />
          Active
        </label>
      </div>
    </FormDialog>
  );
}
