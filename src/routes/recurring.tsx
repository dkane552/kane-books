import { createFileRoute } from "@tanstack/react-router";
import { pageHead } from "@/components/app/shared";
import { RecurringPage } from "@/components/app/recurring";
export const Route = createFileRoute("/recurring")({
  head: () => pageHead("Recurring"),
  component: () => <RecurringPage />,
});
