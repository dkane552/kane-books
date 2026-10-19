import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/shared";
import { BudgetPage } from "@/components/app/budget";
import { defined, month } from "@/lib/search";

export const Route = createFileRoute("/budget")({
  head: () => pageHead("Budget"),
  validateSearch: (s: Record<string, unknown>): { month?: string } =>
    defined({ month: month(s["month"]) }),
  component: BudgetRoute,
});
function BudgetRoute() {
  const { month: m } = Route.useSearch();
  return <BudgetPage month={m} />;
}
