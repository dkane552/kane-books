import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/shared";
import { TransactionsPage } from "@/components/app/transactions";
import { defined, id } from "@/lib/search";

export const Route = createFileRoute("/transactions")({
  head: () => pageHead("Transactions"),
  validateSearch: (s: Record<string, unknown>): { tab?: string; entry?: string } =>
    defined({ tab: s["tab"] === "Entries" ? "Entries" : undefined, entry: id(s["entry"]) }),
  component: TransactionsRoute,
});
function TransactionsRoute() {
  const { tab, entry } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TransactionsPage
      tab={tab ?? "Bank feed"}
      entry={entry}
      onTab={(t) => navigate({ search: { tab: t }, resetScroll: false })}
    />
  );
}
