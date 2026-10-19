// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Cloudflare Pages caches /assets/* for a year as immutable, but a rebuilt chunk can keep its old
// file name while its imports change. A per-build folder makes every deploy's files unique, so a
// browser never mixes an old cached chunk with a new build (that left the app stuck on "Loading").
const BUILD_ID = Date.now().toString(36);

export default defineConfig({
  vite: {
    build: {
      rollupOptions: {
        output: {
          entryFileNames: `assets/${BUILD_ID}/[name]-[hash].js`,
          chunkFileNames: `assets/${BUILD_ID}/[name]-[hash].js`,
          assetFileNames: `assets/${BUILD_ID}/[name]-[hash][extname]`,
        },
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // Static single-page build: the app talks to Supabase from the browser, so hosting is
    // plain files (Cloudflare Pages, free). The shell is written as index.html.
    spa: { enabled: true, prerender: { outputPath: "/index.html" } },
  },
});
