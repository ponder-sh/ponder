import { Context, Effect } from "effect";

/**
 * Runs effects that wait on I/O outside of Ponder's transports, such as the
 * file system, Vite, or the HTTP server.
 *
 * @dev A deterministic simulation replaces it, so that it controls when the
 * result of the I/O reaches the waiting fiber. The default runs the effect.
 */
export const ExternalIo = Context.Reference<{
  run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}>("ponder/ExternalIo", { defaultValue: () => ({ run: (effect) => effect }) });

/** Run `effect`, which waits on external I/O, with {@link ExternalIo}. */
export const externalIo = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const io = yield* ExternalIo;
    return yield* io.run(effect);
  });
