import { Effect, Exit, Semaphore, Stream } from "effect";
import type { DbTransports } from "@/database/db.js";
import type { DbTransport } from "@/database/transport.js";
import { NonRetryableUserError } from "@/internal/errors.js";
import type { Plan } from "./plan.js";
import { Rng } from "./random.js";
import type { SimScheduler } from "./scheduler.js";

/** A failure the simulation injected. Ponder retries it like a Postgres error. */
export class InjectedDbError extends Error {
  override name = "InjectedDbError";
}

/** Wall-clock time before the next statement may start while one waits on a lock. */
const LOCK_WAIT_MS = 2_000;

/**
 * Runs Postgres statements one at a time, in the order they were issued, so
 * that Postgres sees the same order every run, such as for the physical order
 * of rows and the values of sequences.
 *
 * @dev A statement that waits on a lock held by an open transaction, whose next
 * statement is behind it, lets the next statement start after
 * {@link LOCK_WAIT_MS}. Only then the order depends on wall-clock time.
 */
export const makeDbGate = () => {
  let tail: Promise<void> = Promise.resolve();
  let lockWaits = 0;

  /**
   * Waits for the turn, without waiting forever for a statement that waits on
   * a lock. Resolves to the function that ends the turn.
   */
  const acquire = (): Promise<() => void> => {
    let release!: () => void;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = tail;
    tail = done;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        lockWaits++;
        resolve(release);
      }, LOCK_WAIT_MS);
      previous.then(() => {
        clearTimeout(timer);
        resolve(release);
      });
    });
  };

  return {
    /** Run `effect` in its turn. */
    run: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(Effect.promise(acquire), (release) =>
        Effect.ensuring(effect, Effect.sync(release)),
      ),
    acquire,
    lockWaits: () => lockWaits,
  };
};

export type DbGate = ReturnType<typeof makeDbGate>;

type Role = Exclude<keyof DbTransports, "dialect">;

/**
 * The connections of each pool, like `makeDbTransports` in
 * `packages/core/src/database/db.ts` for `ponder start`.
 */
const poolSizes = (poolMax: number): Record<Role, number> => {
  const internalMax = 2;
  const equalMax = Math.floor((poolMax - internalMax) / 3);
  return {
    admin: internalMax,
    user: equalMax,
    readonly: equalMax,
    sync: equalMax,
  };
};

/** Counts of what the database did, for the summary of a run. */
export type DbStats = {
  statements: number;
  transactions: number;
  transactionErrors: number;
};

/**
 * A simulated database: wraps the transports of a Postgres database.
 *
 * Postgres runs outside the simulation, so each statement, and the BEGIN and
 * COMMIT of each transaction, goes through `io`: its result reaches the fiber
 * in a seeded order. The callback of a transaction runs inside the
 * simulation, between them.
 *
 * It also adds latency to each statement, and fails transactions. A failed
 * transaction rolls back after its callback ran, and Ponder runs the callback
 * again. A callback with side effects outside the transaction does them twice.
 *
 * It also holds a connection of the pool of a transport for each statement and
 * transaction, so that a statement waits for a connection in the simulation,
 * in a seeded order. Then the pools of Ponder never make a statement wait.
 *
 * `listen` never receives a notification and holds no connection. Postgres
 * sends notifications at wall-clock times, and only `/sql` live queries,
 * which the simulation does not run, use them.
 *
 * @dev Only transactions fail. Ponder retries a failed statement, and a failed
 * statement in a transaction fails the transaction.
 */
export const makeSimDb = ({
  plan,
  scheduler,
  gate,
}: {
  plan: Plan;
  scheduler: SimScheduler;
  gate: DbGate;
}) => {
  const rng = new Rng(plan.seed, "database");
  const { latency, transactionErrorRate } = plan.database;
  const stats: DbStats = {
    statements: 0,
    transactions: 0,
    transactionErrors: 0,
  };

  /** The app was killed: its statements fail without retries. */
  let isKilled = false;
  const killed = Effect.suspend(() =>
    isKilled
      ? Effect.fail(
          new NonRetryableUserError("Process killed by the simulation"),
        )
      : Effect.void,
  );

  const sleep = Effect.suspend(() =>
    Effect.sleep(rng.int(latency.min, latency.max)),
  );

  const sizes = poolSizes(plan.database.poolMax);
  const pools = {
    admin: Semaphore.makeUnsafe(sizes.admin),
    user: Semaphore.makeUnsafe(sizes.user),
    readonly: Semaphore.makeUnsafe(sizes.readonly),
    sync: Semaphore.makeUnsafe(sizes.sync),
  } satisfies Record<Role, Semaphore.Semaphore>;

  /**
   * @param pool The pool of the transport, or `undefined` for the transport of
   * a transaction, which has its connection.
   */
  const wrapTransport = <T extends DbTransport<any>>(
    transport: T,
    role: Role,
    pool: Semaphore.Semaphore | undefined,
  ): T => {
    const connect = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      pool === undefined ? effect : pool.withPermit(effect);

    return {
      ...transport,
      query: (build) =>
        connect(
          Effect.gen(function* () {
            yield* killed;
            stats.statements++;
            const result = yield* scheduler.io(
              gate.run(transport.query(build)),
            );
            yield* sleep;
            return result;
          }),
        ),
      copy: (target, text) =>
        connect(
          Effect.andThen(
            killed,
            scheduler
              .io(gate.run(transport.copy(target, text)))
              .pipe(Effect.tap(() => sleep)),
          ),
        ),
      transaction: <A, E, R>(
        f: (tx: DbTransport<any>) => Effect.Effect<A, E, R>,
        config?: Parameters<DbTransport["transaction"]>[1],
      ) =>
        connect(
          Effect.gen(function* () {
            yield* killed;
            stats.transactions++;
            const began = Promise.withResolvers<DbTransport<any>>();
            const done = Promise.withResolvers<Exit.Exit<A, E>>();

            // Note: Runs outside the simulation. BEGIN runs in its turn, which ends
            // when the callback starts. Then it waits for the callback, and commits
            // or rolls back.
            const commit = yield* scheduler.outside(
              Effect.flatMap(
                Effect.promise(() => gate.acquire()),
                (release) =>
                  transport
                    .transaction(
                      (tx) =>
                        Effect.promise(() => {
                          release();
                          began.resolve(tx);
                          return done.promise;
                        }).pipe(Effect.flatten),
                      config,
                    )
                    .pipe(Effect.ensuring(Effect.sync(release))),
              ),
            );

            return yield* Effect.gen(function* () {
              const begin = yield* scheduler.io(
                Effect.promise(() =>
                  Promise.race([
                    began.promise.then((tx) => ({ tx }) as const),
                    commit.then((exit) => ({ exit }) as const),
                  ]),
                ),
              );
              if ("exit" in begin) {
                // Note: BEGIN failed.
                return yield* begin.exit as Exit.Exit<A, E | unknown>;
              }

              const exit = yield* Effect.exit(
                f(wrapTransport(begin.tx, role, undefined)).pipe(
                  Effect.flatMap((result) => {
                    if (rng.bool(transactionErrorRate)) {
                      stats.transactionErrors++;
                      return Effect.fail(
                        new InjectedDbError(
                          `deadlock detected in ${role} transaction (injected by the simulation)`,
                        ) as unknown as E,
                      );
                    }
                    return Effect.succeed(result);
                  }),
                ),
              );
              // Note: COMMIT or ROLLBACK runs in its turn.
              const result = yield* scheduler.io(
                Effect.promise(async () => {
                  const release = await gate.acquire();
                  done.resolve(exit);
                  try {
                    return await commit;
                  } finally {
                    release();
                  }
                }),
              );
              yield* sleep;
              return yield* result as Exit.Exit<A, E | unknown>;
            }).pipe(
              // Note: An interrupted callback rolls back the transaction.
              Effect.ensuring(
                Effect.sync(() => done.resolve(Exit.interrupt())),
              ),
            );
          }),
        ),
    };
  };

  return {
    /** Wrap each transport of a database. */
    wrap: (transports: DbTransports): DbTransports => ({
      dialect: transports.dialect,
      admin: {
        ...wrapTransport(transports.admin, "admin", pools.admin),
        listen: () => Effect.succeed(Stream.never),
      },
      user: wrapTransport(transports.user, "user", pools.user),
      readonly: wrapTransport(transports.readonly, "readonly", pools.readonly),
      sync: wrapTransport(transports.sync, "sync", pools.sync),
    }),
    stats,
    /**
     * Fail every statement, like after the process was killed. Interrupting
     * the app rolls back its open transactions.
     */
    kill: () => {
      isKilled = true;
    },
    /** Run statements again, for the next process. */
    revive: () => {
      isKilled = false;
    },
  };
};
