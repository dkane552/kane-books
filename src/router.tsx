import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Live updates mark data stale when it changes, so a page opened again within 30 seconds reuses what it
  // has instead of asking the database again.
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: ({ error }) => (
      <div className="p-8 text-destructive">
        {error instanceof Error ? error.message : "This page could not load."}
      </div>
    ),
  });

  return router;
};
