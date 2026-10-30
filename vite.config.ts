// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Public (publishable) backend values. Fallback for published builds, where .env is
// excluded by .gitignore. Safe to ship: these are browser-visible keys.
const PUBLIC_ENV = {
  VITE_SUPABASE_URL: process.env["VITE_SUPABASE_URL"] || "https://vspeqoilagcjgwjehjzx.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    process.env["VITE_SUPABASE_PUBLISHABLE_KEY"] ||
    "sb_publishable_jRUNUftBZvOjOIGDdbc-YQ_6fxFWY9Y",
  VITE_SUPABASE_PROJECT_ID: process.env["VITE_SUPABASE_PROJECT_ID"] || "vspeqoilagcjgwjehjzx",
};

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: Object.fromEntries(
      Object.entries(PUBLIC_ENV).map(([k, v]) => [`import.meta.env.${k}`, JSON.stringify(v)]),
    ),
  },
});
