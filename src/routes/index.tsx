import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "@/components/app/home";
import { pageHead } from "@/components/app/shared";
export const Route = createFileRoute("/")({
  head: () => pageHead("Home"),
  component: () => <HomePage />,
});
