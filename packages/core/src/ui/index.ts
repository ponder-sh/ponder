import { Effect } from "effect";
import {
  getAppProgress,
  getIndexingProgress,
  getSyncProgress,
  Metrics,
} from "@/internal/metrics.js";
import { Options } from "@/internal/options.js";
import { buildUiLines, initialUiState } from "./app.js";
import { patchWriteStreams } from "./patch.js";

/**
 * Render the terminal UI until the scope closes.
 */
export const createUi = Effect.gen(function* () {
  const options = yield* Options;
  const metrics = yield* Metrics;

  const ui = initialUiState;

  const { refresh } = yield* Effect.acquireRelease(
    Effect.sync(() => patchWriteStreams({ getLines: () => buildUiLines(ui) })),
    ({ shutdown }) => Effect.sync(shutdown),
  );

  // Update the UI state every 100ms (independent of write rate)
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      ui.sync = yield* Effect.promise(() => getSyncProgress(metrics));
      ui.indexing = yield* Effect.promise(() => getIndexingProgress(metrics));
      ui.app = yield* Effect.promise(() => getAppProgress(metrics));

      if (options.hostname) ui.hostname = options.hostname;
      if (metrics.port) ui.port = metrics.port;
    }).pipe(Effect.delay(100), Effect.forever),
  );

  // Refresh the UI every 32ms
  yield* Effect.forkScoped(
    Effect.sync(refresh).pipe(Effect.delay(32), Effect.forever),
  );
});
