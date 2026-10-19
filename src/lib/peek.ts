/** What the side panel can show. */
export type PeekTarget =
  /** An account: its balance and activity (the last 60 days, or from..to). */
  | { kind: "gl"; id: string; from?: string; to?: string }
  /** A ledger entry and its lines. */
  | { kind: "entry"; id: string }
  /** A project: its income and spending this year. */
  | { kind: "project"; id: string }
  /** A payee: what was paid to or received from them. */
  | { kind: "payee"; id: string };

/** One string per target, for keys and for "is this already open". */
export const peekKey = (t: PeekTarget) =>
  `${t.kind}:${t.id}` +
  ("from" in t || "to" in t
    ? `[${"from" in t ? (t.from ?? "") : ""},${"to" in t ? (t.to ?? "") : ""}]`
    : "");

/** A general ledger row's source as something the panel can open. */
export function ledgerTarget(
  source: string | null | undefined,
  id: string | null | undefined,
): PeekTarget | undefined {
  if (!id) return undefined;
  const s = (source ?? "").toLowerCase();
  return s === "entry" ? { kind: "entry", id } : undefined;
}
