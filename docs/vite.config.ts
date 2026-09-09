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
     * straight off disk, and each reaches a CommonJS-only package that then
     * fails at runtime with "does not provide an export named ...":
     *
     * - `micromark` resolves to its `development` export condition in dev
     *   (`dev/lib/*`), a debug-instrumented build that imports `debug`.
     *   `debug` is CommonJS with a legacy `browser` field and no `exports`.
     *   The production build uses the `default` condition and never sees it,
     *   which is why `vite build` stays green.
     * - `sucrase` imports `@jridgewell/*` packages whose `browser` export
     *   condition points at their UMD builds.
     *
     * Pre-bundling the *importer* is what matters: esbuild then resolves these
     * internally and applies CommonJS interop. Including only the leaf package
     * (e.g. `debug`) builds a chunk that nothing uses, because the raw-served
     * importer still resolves the bare specifier to the file on disk.
     *
     * The `vocs > dep` form is required: these are not direct dependencies of
     * this package, so Vite cannot resolve bare specifiers for them and logs
     * "Failed to resolve dependency: ..., present in client optimizeDeps.include".
     */
    include: ["vocs > micromark", "vocs > sucrase"],
  },
});
