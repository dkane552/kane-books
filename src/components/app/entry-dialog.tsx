// New and edit dialogs for entries (expense, deposit, transfer, journal, opening balances) and value updates.
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormDialog, Money, Select, confirmAction } from "./shared";
import { AccountOptions, PayeeInput, ProjectOptions } from "./pickers";
import { ENTRY_KIND } from "./peek";
import {
  rpc,
  useBankFeedAccounts,
  useDb,
  useGlAccounts,
  usePayees,
  useReport,
  useSettings,
} from "@/lib/data";
import { BALANCE_TYPES, CATEGORY_TYPES, TAX_LINES, VALUED_TYPES } from "@/lib/accounts";
import { money, num, todayISO } from "@/lib/format";
import type { BalanceRow, LedgerEntry, LedgerEntryType } from "@/lib/types";

interface FormLine {
  gl_account_id: string;
  amount: string;
  debit: string;
  credit: string;
  description: string;
  project_id: string;
  tax_line: string;
}
const emptyLine = (): FormLine => ({
  gl_account_id: "",
  amount: "",
  debit: "",
  credit: "",
  description: "",
  project_id: "",
  tax_line: "",
});

/** Find or add the payee by name; null for blank. */
export async function payeeId(name: string): Promise<string | null> {
  if (!name.trim()) return null;
  return (await rpc("payee_for", { p_name: name.trim() })) as string | null;
}

export function EntryDialog({
  type: initialType,
  entry,
  onClose,
}: {
  type: LedgerEntryType;
  entry?: LedgerEntry | undefined;
  onClose: () => void;
}) {
  const { data: gl } = useGlAccounts();
  const { data: payees } = usePayees();
  const { data: settings } = useSettings();
  const db = useDb();
  const [type, setType] = useState<LedgerEntryType>(
    initialType === "valuation" ? "journal" : initialType,
  );
  const [date, setDate] = useState(entry?.entry_date ?? todayISO());
  const [number, setNumber] = useState(entry?.number ?? "");
  const [payee, setPayee] = useState("");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  const [moneyAcct, setMoneyAcct] = useState("");
  const [toAcct, setToAcct] = useState("");
  const [amount, setAmount] = useState("");
  const [lines, setLines] = useState<FormLine[]>([emptyLine(), emptyLine()]);
  const [showTax, setShowTax] = useState(false);
  const balanceIds = useMemo(
    () =>
      new Set((gl ?? []).filter((a) => BALANCE_TYPES.includes(a.account_type)).map((a) => a.id)),
    [gl],
  );
  const fromFeed = !!entry?.external_ref?.startsWith("era:");

  useEffect(() => {
    if (entry?.payee_id && payees)
      setPayee(payees.find((p) => p.id === entry.payee_id)?.name ?? "");
  }, [entry?.payee_id, payees]);

  // Load an existing entry into the simplest form that fits it.
  useEffect(() => {
    if (!entry || !gl) return;
    const ls = [...(entry.ledger_lines ?? [])].sort((a, b) => a.position - b.position);
    const credits = ls.filter((l) => num(l.credit) > 0);
    const debits = ls.filter((l) => num(l.debit) > 0);
    const toForm = (l: (typeof ls)[number]): FormLine => ({
      gl_account_id: l.gl_account_id,
      amount: String(num(l.debit) || num(l.credit)),
      debit: num(l.debit) ? String(num(l.debit)) : "",
      credit: num(l.credit) ? String(num(l.credit)) : "",
      description: l.description ?? "",
      project_id: l.project_id ?? "",
      tax_line: l.tax_line ?? "",
    });
    if (ls.some((l) => l.tax_line)) setShowTax(true);
    if (
      entry.entry_type === "expense" &&
      credits.length === 1 &&
      balanceIds.has(credits[0]!.gl_account_id)
    ) {
      setMoneyAcct(credits[0]!.gl_account_id);
      setLines(debits.map(toForm));
    } else if (
      entry.entry_type === "deposit" &&
      debits.length === 1 &&
      balanceIds.has(debits[0]!.gl_account_id)
    ) {
      setMoneyAcct(debits[0]!.gl_account_id);
      setLines(credits.map(toForm));
    } else if (
      entry.entry_type === "transfer" &&
      ls.length === 2 &&
      credits.length === 1 &&
      debits.length === 1
    ) {
      setMoneyAcct(credits[0]!.gl_account_id);
      setToAcct(debits[0]!.gl_account_id);
      setAmount(String(num(debits[0]!.debit)));
    } else {
      setType(entry.entry_type === "opening" ? "opening" : "journal");
      setLines(ls.map(toForm));
    }
    // load once per entry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.id, gl]);

  useEffect(() => {
    if (!entry && !moneyAcct && settings) setMoneyAcct(settings.default_cash_gl_id ?? "");
  }, [entry, moneyAcct, settings]);

  const setLine = (i: number, patch: Partial<FormLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const lineTotal = lines.reduce((s, l) => s + Number(l.amount || 0), 0);
  const dr = lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const twoSided = type === "journal" || type === "opening";

  function payload() {
    const used = lines.filter(
      (l) => l.gl_account_id && (Number(l.amount) || Number(l.debit) || Number(l.credit)),
    );
    const base = (l: FormLine) => ({
      gl_account_id: l.gl_account_id,
      description: l.description || null,
      project_id: l.project_id || null,
      tax_line: l.tax_line || null,
    });
    if (type === "transfer") {
      const a = Number(amount || 0);
      return [
        { gl_account_id: toAcct, debit: a, credit: 0, description: memo || null },
        { gl_account_id: moneyAcct, debit: 0, credit: a, description: memo || null },
      ];
    }
    if (twoSided)
      return used.map((l) => ({
        ...base(l),
        debit: Number(l.debit || 0),
        credit: Number(l.credit || 0),
      }));
    const rows = used.map((l) => ({
      ...base(l),
      debit: type === "expense" ? Number(l.amount) : 0,
      credit: type === "deposit" ? Number(l.amount) : 0,
    }));
    const total = rows.reduce((s, r) => s + r.debit + r.credit, 0);
    return [
      ...rows,
      {
        gl_account_id: moneyAcct,
        debit: type === "deposit" ? total : 0,
        credit: type === "expense" ? total : 0,
        description: memo || null,
      },
    ];
  }

  async function save() {
    if ((type === "expense" || type === "deposit" || type === "transfer") && !moneyAcct)
      return void toast.error("Choose the account the money moved through");
    if (type === "transfer" && (!toAcct || !(Number(amount) > 0)))
      return void toast.error("Choose both accounts and an amount");
    if (twoSided && Math.abs(dr - cr) > 0.004)
      return void toast.error(`Debits ${money(dr)} and credits ${money(cr)} must match`);
    const p = payload();
    if (p.length < 2 || p.some((l) => !l.gl_account_id))
      return void toast.error("Every line needs an account and an amount");
    try {
      await db.batch(async () => {
        const pid = await payeeId(payee);
        await rpc("save_ledger_entry", {
          p_entry: {
            id: entry?.id,
            entry_type: type,
            entry_date: date,
            number: number || null,
            payee_id: pid,
            memo: memo || null,
          },
          p_lines: p.map((l, i) => ({ ...l, position: i + 1 })),
        });
      });
      toast.success("Saved");
      onClose();
    } catch {
      // useDb showed the error
    }
  }

  const moneyLabel =
    type === "expense" ? "Paid from" : type === "deposit" ? "Deposited to" : "From";
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`${entry ? "Edit" : "New"} ${(ENTRY_KIND[type] ?? "entry").toLowerCase()}`}
      {...(fromFeed
        ? {
            description:
              "Added from the bank feed. Edits here stay; undo it in Transactions to start over.",
          }
        : {})}
      {...(type === "opening" && !entry
        ? {
            description:
              "What each account held (or owed) on the day the books start. The difference goes to Opening balance equity.",
          }
        : {})}
      wide
      busy={db.pending}
      onSubmit={save}
      footerLeft={
        entry && (
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                if (
                  !confirmAction(
                    entry.is_void
                      ? "Restore this entry?"
                      : "Void this entry? It stays on file but stops counting.",
                  )
                )
                  return;
                await db.update("ledger_entries", entry.id, { is_void: !entry.is_void });
                onClose();
              }}
            >
              {entry.is_void ? "Restore" : "Void"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                if (!confirmAction("Delete this entry? The audit log keeps a copy.")) return;
                await db.remove("ledger_entries", entry.id);
                onClose();
              }}
            >
              <Trash2 />
              Delete
            </Button>
          </div>
        )
      }
    >
      <Field label="Date">
        <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Check # or reference">
        <Input value={number} onChange={(e) => setNumber(e.target.value)} />
      </Field>
      {!twoSided && (
        <Field label={moneyLabel}>
          <Select value={moneyAcct} onChange={setMoneyAcct} required>
            <option value="">Choose an account</option>
            <AccountOptions accounts={gl} types={BALANCE_TYPES} keep={moneyAcct} />
          </Select>
        </Field>
      )}
      {type === "transfer" ? (
        <>
          <Field label="To">
            <Select value={toAcct} onChange={setToAcct} required>
              <option value="">Choose an account</option>
              <AccountOptions
                accounts={gl}
                types={BALANCE_TYPES}
                exclude={moneyAcct}
                keep={toAcct}
              />
            </Select>
          </Field>
          <Field label="Amount">
            <Input
              type="number"
              step="0.01"
              min="0"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <Field label={type === "deposit" ? "Received from" : "Payee"}>
          <PayeeInput value={payee} onChange={setPayee} />
        </Field>
      )}
      <Field label="Memo" full>
        <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
      </Field>
      {type !== "transfer" && (
        <div className="full col-span-2">
          <div className="data-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{twoSided ? "Account" : "Category"}</th>
                  <th>Description</th>
                  <th>Project</th>
                  {showTax && <th>Tax line</th>}
                  {twoSided ? (
                    <>
                      <th className="numeric">Debit</th>
                      <th className="numeric">Credit</th>
                    </>
                  ) : (
                    <th className="numeric">Amount</th>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td className="min-w-[190px]">
                      <Select
                        value={l.gl_account_id}
                        onChange={(v) => setLine(i, { gl_account_id: v })}
                        ariaLabel="Account"
                      >
                        <option value="">Choose</option>
                        <AccountOptions
                          accounts={gl}
                          types={twoSided ? undefined : [...CATEGORY_TYPES, ...BALANCE_TYPES]}
                          exclude={twoSided ? undefined : moneyAcct}
                          keep={l.gl_account_id}
                        />
                      </Select>
                    </td>
                    <td>
                      <Input
                        value={l.description}
                        onChange={(e) => setLine(i, { description: e.target.value })}
                        aria-label="Description"
                      />
                    </td>
                    <td className="min-w-[120px]">
                      <Select
                        value={l.project_id}
                        onChange={(v) => setLine(i, { project_id: v })}
                        ariaLabel="Project"
                      >
                        <option value="">None</option>
                        <ProjectOptions keep={l.project_id} />
                      </Select>
                    </td>
                    {showTax && (
                      <td className="min-w-[150px]">
                        <Select
                          value={l.tax_line}
                          onChange={(v) => setLine(i, { tax_line: v })}
                          ariaLabel="Tax line"
                        >
                          <option value="">The category's</option>
                          {TAX_LINES.map((t) => (
                            <option key={t}>{t}</option>
                          ))}
                        </Select>
                      </td>
                    )}
                    {twoSided ? (
                      <>
                        <td className="w-28">
                          <Input
                            type="number"
                            step="0.01"
                            value={l.debit}
                            onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })}
                            aria-label="Debit"
                          />
                        </td>
                        <td className="w-28">
                          <Input
                            type="number"
                            step="0.01"
                            value={l.credit}
                            onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })}
                            aria-label="Credit"
                          />
                        </td>
                      </>
                    ) : (
                      <td className="w-32">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          value={l.amount}
                          onChange={(e) => setLine(i, { amount: e.target.value })}
                          aria-label="Amount"
                        />
                      </td>
                    )}
                    <td>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label="Remove line"
                        onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                      >
                        <Trash2 />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setLines((ls) => [...ls, emptyLine()])}
              >
                <Plus />
                Add line
              </Button>
              {!showTax && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowTax(true)}>
                  Set a tax line
                </Button>
              )}
            </div>
            {twoSided ? (
              <span
                className={Math.abs(dr - cr) > 0.004 ? "text-destructive" : "text-muted-foreground"}
              >
                Debits <span className="number">{money(dr)}</span> Credits{" "}
                <span className="number">{money(cr)}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">
                Total <span className="number">{money(lineTotal)}</span>
              </span>
            )}
          </div>
          {twoSided && type === "opening" && (
            <p className="mt-2 text-[length:calc(11px*var(--ts,1))] text-muted-foreground">
              Debit what you own, credit what you owe, and put the difference as a credit to Opening
              balance equity.
            </p>
          )}
        </div>
      )}
    </FormDialog>
  );
}

/**
 * What an investment, retirement account, house or car is worth on a date. One value update per account
 * per day moves the books to that value; the change shows as "Investment and asset value changes".
 */
export function ValueDialog({
  accountId,
  onClose,
}: {
  accountId?: string | undefined;
  onClose: () => void;
}) {
  const { data: gl } = useGlAccounts();
  const { data: feeds } = useBankFeedAccounts();
  const db = useDb();
  const [account, setAccount] = useState(accountId ?? "");
  const [date, setDate] = useState(todayISO());
  const [value, setValue] = useState("");
  const bal = useReport<BalanceRow>("account_balances", { p_as_of: date });
  const books = num(bal.data?.find((b) => b.gl_account_id === account)?.balance);
  const bank = (feeds ?? []).filter((f) => f.gl_account_id === account && f.balance !== null);
  const bankTotal = bank.reduce((s, f) => s + num(f.balance), 0);
  const a = gl?.find((x) => x.id === account);
  useEffect(() => {
    if (!accountId && !account && gl)
      setAccount(gl.find((x) => x.is_valued && x.is_active)?.id ?? "");
  }, [gl, account, accountId]);
  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Update a value"
      description="What it is worth now. The books move to this value and the change counts as a gain or loss."
      submitLabel="Update"
      busy={db.pending}
      onSubmit={async () => {
        if (!account || value === "")
          return void toast.error("Pick the account and enter its value");
        try {
          const change = (await db.batch(() =>
            rpc("post_valuation", { p_account: account, p_date: date, p_value: Number(value) }),
          )) as number;
          toast.success(
            num(change)
              ? `Value updated (${num(change) > 0 ? "up" : "down"} ${money(Math.abs(num(change)))})`
              : "Already at that value",
          );
          onClose();
        } catch {
          // shown
        }
      }}
    >
      <Field label="Account" full>
        <Select value={account} onChange={setAccount} required>
          <option value="">Choose an account</option>
          <AccountOptions accounts={gl} types={VALUED_TYPES} keep={account} />
        </Select>
      </Field>
      <Field label="As of">
        <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
      <Field label="Value">
        <Input
          type="number"
          step="0.01"
          min="0"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <div className="full col-span-2 text-xs text-muted-foreground">
        {a ? (
          <>
            In the books on that day: <Money value={books} />.
            {bank.length > 0 && (
              <>
                {" "}
                The bank feed says <Money value={bankTotal} />{" "}
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => setValue(String(bankTotal))}
                >
                  Use it
                </button>
                .
              </>
            )}
            {value !== "" && (
              <>
                {" "}
                Change: <Money value={Number(value) - books} />.
              </>
            )}
          </>
        ) : (
          "Pick an investment, retirement, property or vehicle account. Add one in Accounts if it is not listed."
        )}
      </div>
    </FormDialog>
  );
}
