import { type Context, Effect, type Scope } from "effect";
import type { Db } from "@/database/db.js";

/**
 * Services for the API functions in `src/api/index.ts`, such as the
 * `client()` and `graphql()` middlewares, and the scope of the API build.
 *
 * @dev The API functions are created while the API file runs, outside of a
 * fiber, so they read the context from `globalThis.PONDER_API_CONTEXT`. Their
 * background fibers stop when the scope closes.
 */
export type ApiContext = Context.Context<Db | Scope.Scope>;

declare global {
  var PONDER_API_CONTEXT: ApiContext | undefined;
}

/**
 * Make the services and scope of the current fiber available to the API
 * functions until the scope closes. Run before running the API file.
 */
export const setApiContext: Effect.Effect<void, never, Db | Scope.Scope> =
  Effect.acquireRelease(
    Effect.map(Effect.context<Db | Scope.Scope>(), (context) => {
      globalThis.PONDER_API_CONTEXT = context;
      return context;
    }),
    (context) =>
      Effect.sync(() => {
        if (globalThis.PONDER_API_CONTEXT === context) {
          globalThis.PONDER_API_CONTEXT = undefined;
        }
      }),
  ).pipe(Effect.asVoid);
