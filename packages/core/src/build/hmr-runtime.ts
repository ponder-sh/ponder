// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { Plugin, Update, ViteDevServer } from "vite";

import { debounce } from "@/utils/debounce";

/**
 * Vite emits HMR events via a Websocket server to clients, but does not
 * offer hooks for listening to those events server-side. This plugin attaches
 * an event emitter to the dev server that forwards all `ws.send` method calls.
 */
export function ponderHmrRuntimePlugin({
  onUpdate,
  onFullReload,
}: {
  onUpdate: (args: {
    updates: Update[];
    server: ViteDevServer;
  }) => void | Promise<void>;
  onFullReload: (args: { server: ViteDevServer }) => void | Promise<void>;
}): Plugin {
  return {
    name: "ponder:hmr-runtime",
    transform: (code_) => {
      let code = code_;

      // Matches `import { ponder } from "@/generated";` with whitespaces and newlines.
      const regex =
        /import\s+\{\s*ponder\s*\}\s+from\s+(['"])@\/generated\1\s*;?/g;
      if (regex.test(code)) {
        // Add shim object to collect user functions.
        const shimHeader = `
          export let ponder = {
            fns: [],
            on(name, fn) {
              this.fns.push({ name, fn });
            },
          };
        `;
        code = `${shimHeader}\n${code.replace(regex, "")}`;
      }

      // When Vite detects a new version of a module, simply replace the
      // exported object inplace rather than do a full reload.
      const metaHotFooter = `
        if (import.meta.hot) {
          import.meta.hot.accept(() => {});
        }
      `;
      code = `${code}${metaHotFooter}`;

      return code;
    },
    configureServer: (server) => {
      const hmrUpdates: Update[] = [];
      const debouncedHmrUpdateHandler = debounce(105, async () => {
        const updates = hmrUpdates.splice(0, hmrUpdates.length);
        // Dedupe, only pass along the latest update by file path.
        const latestUpdates: Record<string, Update> = {};
        for (const update of updates) {
          if (
            !(update.path in latestUpdates) ||
            update.timestamp > latestUpdates[update.path].timestamp
          ) {
            latestUpdates[update.path] = update;
          }
        }
        await onUpdate({ updates: Object.values(latestUpdates), server });
      });

      server.emitter.on("update", async ({ updates }) => {
        hmrUpdates.push(...updates);
        debouncedHmrUpdateHandler();
      });

      server.emitter.on("full-reload", async () => {
        await onFullReload({ server });
      });
    },
  };
}
