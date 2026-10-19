// Pickers shared by the entry, bank feed, budget and recurring screens.
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { usePayees, useProjects } from "@/lib/data";
import { ALL_TYPES, glLabel, TYPE_LABEL } from "@/lib/accounts";
import type { GlAccount, GlAccountType } from "@/lib/types";

/**
 * <option>s for accounts, grouped: balance accounts by type, categories by their group
 * (Housing, Food, ...). `types` limits which accounts show; `exclude` leaves one out.
 */
export function AccountOptions({
  accounts,
  types,
  exclude,
  keep,
}: {
  accounts: GlAccount[] | undefined;
  types?: GlAccountType[] | undefined;
  exclude?: string | null | undefined;
  /** Show this one even when it is inactive (the value already chosen). */
  keep?: string | null | undefined;
}) {
  const list = (accounts ?? []).filter(
    (a) =>
      (a.is_active || a.id === keep) &&
      a.id !== exclude &&
      (!types || types.includes(a.account_type)),
  );
  const groups = new Map<string, GlAccount[]>();
  for (const t of ALL_TYPES) {
    for (const a of list.filter((x) => x.account_type === t)) {
      const g =
        t === "Expense" || t === "Income"
          ? `${TYPE_LABEL[t]}: ${a.category_group ?? "Other"}`
          : TYPE_LABEL[t];
      groups.set(g, [...(groups.get(g) ?? []), a]);
    }
  }
  return (
    <>
      {[...groups.entries()].map(([g, items]) => (
        <optgroup key={g} label={g}>
          {items.map((a) => (
            <option key={a.id} value={a.id}>
              {glLabel(a)}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/** Project <option>s (active ones, plus the one already chosen). */
export function ProjectOptions({ keep }: { keep?: string | null | undefined }) {
  const { data: projects } = useProjects();
  return (
    <>
      {(projects ?? [])
        .filter((p) => p.is_active || p.id === keep)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
    </>
  );
}

/** Type a payee: picks an existing one or names a new one (saved with the entry). */
export function PayeeInput({
  value,
  onChange,
  ariaLabel = "Payee",
}: {
  value: string;
  onChange: (v: string) => void;
  ariaLabel?: string;
}) {
  const { data: payees } = usePayees();
  const id = useId();
  return (
    <>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        list={id}
        aria-label={ariaLabel}
        placeholder="Type a name"
        autoComplete="off"
      />
      <datalist id={id}>
        {(payees ?? [])
          .filter((p) => p.is_active)
          .map((p) => (
            <option key={p.id} value={p.name} />
          ))}
      </datalist>
    </>
  );
}
