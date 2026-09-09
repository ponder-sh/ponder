import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { vocs } from "vocs/vite";

/**
 * Vocs reads `vocs.config.ts` for docs configuration; this file only controls
 * the Vite server and build pipeline.
 *
 * It exists because the `vocs` CLI creates Vite with `configFile: false`, so a
 * project Vite config is ignored unless the scripts run `vite` directly (see
 * `package.json`, and https://vocs.dev/features/vite). `react()` is added
 * explicitly for the same reason — the `vocs` CLI injects it internally.
 */
export default defineConfig({
  plugins: [react(), vocs()],
  optimizeDeps: {
    /**
     * Force these into Vite's dependency pre-bundle.
     *
     * Vocs lazily imports both from its client bundle, which Vite serves
     * straight off disk. Neither ships browser ESM: `debug` is CommonJS with a
     * legacy `browser` field, and `sucrase` pulls in `@jridgewell/*` packages
     * whose `browser` export condition points at UMD. Served raw, they fail at
     * runtime with "does not provide an export named ...". Pre-bundling lets
     * esbuild apply CommonJS interop so the named and default imports resolve.
     *
     * The `vocs > dep` form is required: these are not direct dependencies of
     * this package, so Vite cannot resolve bare specifiers for them and logs
     * "Failed to resolve dependency: ..., present in client optimizeDeps.include".
     */
    include: ["vocs > debug", "vocs > sucrase"],
  },
});
