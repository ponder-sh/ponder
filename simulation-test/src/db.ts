import { Effect, Exit, Scope, Semaphore, Stream } from "effect";
import type { DbTransports } from "../../packages/core/src/database/db.js";
import {
  type CompiledStatement,
  DbError,
  type DbTransport,
  type DbTransportTransaction,
} from "../../packages/core/src/database/transport.js";
import type { Plan } from "./plan.js";
import { Rng } from "./random.js";
import type { SimScheduler } from "./scheduler.js";

/** Wall-clock time before the next statement may start while one waits on a lock. */
const LOCK_WAIT_MS = 2_000;

/** Postgres fails it as a serialization failure, so its transaction rolls back. */
const ROLLBACK: CompiledStatement = {
  sql: "DO $$ BEGIN RAISE EXCEPTION 'simulated rollback' USING ERRCODE = 'serialization_failure'; END $$",
  params: [],
};

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

/** Only the first attempts of a run fail, so Ponder never runs out of retries. */
const MAX_INJECTED_ATTEMPTS = 2;

/**
 * A simulated database: wraps the transports of a Postgres database.
 *
 * Postgres runs outside the simulation, so each list of statements, and the
 * `BEGIN`, each `run` and the `COMMIT` of an open transaction, goes through
 * `io`: its result reaches the fiber in a seeded order, after a latency.
 *
 * At `transactionErrorRate`, a list of statements rolls back at a drawn
 * statement: Postgres runs the statements before it, then fails with a
 * serialization failure. A run retries it, and an open transaction runs the
 * statements that succeeded again in a new transaction.
 *
 * A list holds a connection of the pool of its role while it runs, and an open
 * transaction holds one until it ends, so a statement waits for a connection
 * in the simulation, in a seeded order. Then the pools of Ponder never make a
 * statement wait.
 *
 * `listen` never receives a notification and holds no connection. Postgres
 * sends notifications at wall-clock times, and only `/sql` live queries,
 * which the simulation does not run, use them.
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
          new DbError({
            sql: "",
            cause: new Error("Process killed by the simulation"),
            notApplied: false,
          }),
        )
      : Effect.void,
  );

  const sleep = Effect.suspend(() =>
    Effect.sleep(rng.int(latency.min, latency.max)),
  );

  /** Run `effect` outside the simulation in its turn, then wait for the latency. */
  const io = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.andThen(killed, scheduler.io(gate.run(effect))).pipe(
      Effect.exit,
      Effect.tap(() => sleep),
      Effect.flatten,
    );

  // Note: Ponder sends the same list of statements again when it retries.
  const attempts = new WeakMap<readonly CompiledStatement[], number>();
  let commitAttempts = 0;

  /**
   * `statements` with a rollback at a drawn statement, or `undefined` for the
   * statements as they are.
   */
  const inject = (statements: readonly CompiledStatement[]) => {
    const attempt = attempts.get(statements) ?? 0;
    attempts.set(statements, attempt + 1);
    if (attempt >= MAX_INJECTED_ATTEMPTS) return undefined;
    if (rng.bool(transactionErrorRate) === false) return undefined;
    stats.transactionErrors++;
    return [...statements.slice(0, rng.int(0, statements.length)), ROLLBACK];
  };

  /** Fail with an error that `ROLLBACK` caused, and die if it didn't fail. */
  const expectRollback = <A>(effect: Effect.Effect<A, DbError>) =>
    effect.pipe(
      Effect.flatMap(() =>
        Effect.die(new Error("Simulated rollback committed")),
      ),
      Effect.catchIf(
        (error) => error.sql !== ROLLBACK.sql,
        (error) => Effect.die(error),
      ),
    );

  const sizes = poolSizes(plan.database.poolMax);
  const pools = {
    admin: Semaphore.makeUnsafe(sizes.admin),
    user: Semaphore.makeUnsafe(sizes.user),
    readonly: Semaphore.makeUnsafe(sizes.readonly),
    sync: Semaphore.makeUnsafe(sizes.sync),
  } satisfies Record<Role, Semaphore.Semaphore>;

  const wrapTransaction = (
    tx: DbTransportTransaction,
  ): DbTransportTransaction => ({
    run: (statements, savepoint) =>
      Effect.suspend(() => {
        stats.statements += statements.length;
        const injected = inject(statements);
        return injected === undefined
          ? io(tx.run(statements, savepoint))
          : expectRollback(io(tx.run(injected, false)));
      }),
    commit: Effect.suspend(() => {
      if (
        commitAttempts < MAX_INJECTED_ATTEMPTS &&
        rng.bool(transactionErrorRate)
      ) {
        commitAttempts++;
        stats.transactionErrors++;
        return expectRollback(io(tx.run([ROLLBACK], false)));
      }
      commitAttempts = 0;
      return io(tx.commit);
    }),
  });

  const wrapTransport = <T extends DbTransport>(
    transport: T,
    pool: Semaphore.Semaphore,
  ): T => ({
    ...transport,
    run: (statements) =>
      Effect.suspend(() => {
        stats.statements += statements.length;
        stats.transactions++;
        const injected = inject(statements);
        return pool.withPermit(
          injected === undefined
            ? io(transport.run(statements))
            : expectRollback(io(transport.run(injected))),
        );
      }),
    begin: Effect.gen(function* () {
      stats.transactions++;
      yield* Effect.acquireRelease(pool.take(1), () => pool.release(1));
      const { tx } = yield* Effect.acquireRelease(
        io(
          Effect.gen(function* () {
            const scope = yield* Scope.make();
            const tx = yield* transport.begin.pipe(
              Scope.provide(scope),
              Effect.onError((cause) =>
                Scope.close(scope, Exit.failCause(cause)),
              ),
            );
            return { scope, tx };
          }),
        ),
        ({ scope }) => scheduler.io(gate.run(Scope.close(scope, Exit.void))),
      );
      return wrapTransaction(tx);
    }),
  });

  return {
    /** Wrap each transport of a database. */
    wrap: (transports: DbTransports): DbTransports => ({
      dialect: transports.dialect,
      admin: {
        ...wrapTransport(transports.admin, pools.admin),
        listen: () => Effect.succeed(Stream.never),
      },
      user: wrapTransport(transports.user, pools.user),
      readonly: wrapTransport(transports.readonly, pools.readonly),
      sync: wrapTransport(transports.sync, pools.sync),
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
