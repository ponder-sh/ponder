import { Clock, Context, Effect, type Exit, Scheduler } from "effect";
import type { Rng } from "./random.js";

/** Wall-clock time that an I/O may take before the step loop suspects a lock. */
const LOCK_WAIT_MS = 2_000;

type Task = { run: () => void; priority: number; dispatcher?: object };

type Io = {
  exit: Promise<Exit.Exit<unknown, unknown>>;
  resume: (exit: Exit.Exit<unknown, unknown>) => void;
};

/** The real clock, for effects that run outside the simulation. */
const realClock = Effect.runSync(Effect.service(Clock.Clock));

/** Resolves to `undefined` if `promise` takes longer than {@link LOCK_WAIT_MS}. */
const withTimeout = async <T>(promise: Promise<T>): Promise<T | undefined> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), LOCK_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  return result;
};

/** A `Scheduler` that runs tasks only from the step loop, in a seeded order. */
export type SimScheduler = Scheduler.Scheduler & {
  /**
   * Runs `effect` outside the simulation, with the real scheduler and clock.
   * Its result reaches the fiber in a seeded order, when the step loop
   * releases it.
   */
  io: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  /**
   * Starts `effect` outside the simulation, with the real scheduler and
   * clock, and returns its result as a promise. Only {@link io} may wait for
   * the promise.
   */
  outside: <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<Promise<Exit.Exit<A, E>>, never, R>;
  /** Queues `run` as a task. */
  schedule: (run: () => void) => void;
  /**
   * Runs tasks until none is ready, then releases one I/O, in a seeded order,
   * until no task is ready and no I/O is in flight. Returns early when an I/O
   * waits on a lock.
   */
  runUntilIdle: () => Promise<void>;
  /** The number of tasks that ran. */
  steps: () => number;
  /** The number of I/O results released out of the seeded order. */
  lockWaits: () => number;
  /** The number of I/O in flight. */
  inFlight: () => number;
};

/**
 * @param jump Called before a task with probability `jumpRate`, to move the
 * clock while fibers are still running.
 */
export function makeSimScheduler({
  random,
  jumpRate,
  jump,
}: {
  random: Rng;
  jumpRate: number;
  jump: () => void;
}): SimScheduler {
  const tasks: Task[] = [];
  /** Releases whose I/O did not finish within {@link LOCK_WAIT_MS}. */
  let lockWaits = 0;
  const inFlight: Io[] = [];
  let steps = 0;

  /** Runs one task of the lowest priority, picked at random. */
  const runOne = () => {
    if (jumpRate > 0 && random.next() < jumpRate) jump();
    let priority = Number.POSITIVE_INFINITY;
    for (const task of tasks) priority = Math.min(priority, task.priority);
    const ready: number[] = [];
    for (let i = 0; i < tasks.length; i++) {
      if (tasks[i]!.priority === priority) ready.push(i);
    }
    const index = ready[Math.floor(random.next() * ready.length)]!;
    const [task] = tasks.splice(index, 1);
    steps++;
    task!.run();
  };

  const schedule = (run: () => void) => {
    tasks.push({ run, priority: 0 });
  };

  const realScheduler = new Scheduler.MixedScheduler();

  const toOutside = <R>(context: Context.Context<R>) =>
    Context.add(
      Context.add(context, Scheduler.Scheduler, realScheduler),
      Clock.Clock,
      realClock,
    );

  const outside = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.map(Effect.context<R>(), (context) =>
      Effect.runPromiseExitWith(toOutside(context))(effect),
    );

  const io = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(Effect.context<R>(), (context) =>
      Effect.callback<A, E>((resume) => {
        inFlight.push({
          exit: Effect.runPromiseExitWith(toOutside(context))(effect),
          resume: resume as Io["resume"],
        });
      }),
    );

  /**
   * Lets promise continuations run before the loop continues, such as an
   * indexing function that awaits the store. They queue their tasks now, not
   * at a time that depends on wall-clock time.
   */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  /**
   * Waits for one I/O, picked at random, then queues its result as a task.
   * Results reach their fibers in the seeded order, not the order they
   * finished.
   *
   * @returns `false` if the I/O did not finish within {@link LOCK_WAIT_MS}.
   */
  const release = async (): Promise<boolean> => {
    const index = random.int(0, inFlight.length - 1);
    const exit = await withTimeout(inFlight[index]!.exit);
    if (exit === undefined) {
      // Note: The I/O waits for something else, such as a Postgres lock held
      // by a transaction whose fiber waits for the clock. The caller moves the
      // clock or calls again, and the next call draws again.
      lockWaits++;
      return false;
    }
    const [next] = inFlight.splice(index, 1);
    // Tasks that promises outside `io` queued during the wait go first, so
    // their order among the tasks does not depend on how long the wait was.
    await settle();
    schedule(() => next!.resume(exit));
    return true;
  };

  const runUntilIdle = async () => {
    while (true) {
      if (tasks.length > 0) {
        runOne();
        continue;
      }
      if (inFlight.length > 0) {
        // Note: The I/O can wait for the clock to move.
        if ((await release()) === false) return;
        continue;
      }
      await settle();
      if (tasks.length === 0 && inFlight.length === 0) return;
    }
  };

  return {
    executionMode: "async",
    shouldYield: (fiber) =>
      fiber.currentOpCount >= fiber.getRef(Scheduler.MaxOpsBeforeYield),
    makeDispatcher: () => {
      const dispatcher = {
        scheduleTask: (run: () => void, priority: number) => {
          tasks.push({ run, priority, dispatcher });
        },
        // Note: The `SchedulerDispatcher` contract: run the queued tasks of
        // this dispatcher now. Nothing calls it in the simulation, because
        // `Effect.runSync` uses its own scheduler. It leaves the tasks of other
        // dispatchers to the step loop, to keep them in the seeded order.
        flush: () => {
          while (true) {
            const index = tasks.findIndex(
              (task) => task.dispatcher === dispatcher,
            );
            if (index === -1) return;
            const [task] = tasks.splice(index, 1);
            task!.run();
          }
        },
      };
      return dispatcher;
    },
    io,
    outside,
    schedule,
    lockWaits: () => lockWaits,
    inFlight: () => inFlight.length,
    runUntilIdle,
    steps: () => steps,
  };
}
