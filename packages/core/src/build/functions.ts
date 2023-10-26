import { type Message, build, formatMessagesSync } from "esbuild";
import glob from "glob";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { replaceTscAliasPaths } from "tsc-alias";
import type { Hex } from "viem";

import { LogEventMetadata } from "@/config/abi";
import { Factory } from "@/config/factories";
import type { LogFilter } from "@/config/logFilters";
import type { Options } from "@/config/options";
import type { Block } from "@/types/block";
import type { Log } from "@/types/log";
import type { Transaction } from "@/types/transaction";

export interface LogEvent {
  name: string;
  params: Record<string, any>;
  log: Log;
  block: Block;
  transaction: Transaction;
}

type EventSourceName = string;
type EventName = string;

type LogEventIndexingFunction = ({
  event,
  context,
}: {
  event: LogEvent;
  context: unknown;
}) => Promise<void> | void;

type SetupEventIndexingFunction = ({
  context,
}: {
  context: unknown;
}) => Promise<void> | void;

type RawIndexingFunctions = {
  _meta_?: {
    setup?: SetupEventIndexingFunction;
  };
  eventSources: {
    [key: EventSourceName]: {
      [key: EventName]: LogEventIndexingFunction;
    };
  };
};

// @ponder/core creates an instance of this class called `ponder`
export class PonderApp<
  IndexingFunctions = Record<string, LogEventIndexingFunction>
> {
  private indexingFunctions: RawIndexingFunctions = { eventSources: {} };
  private errors: Error[] = [];

  on<EventName extends Extract<keyof IndexingFunctions, string>>(
    name: EventName,
    indexingFunction: IndexingFunctions[EventName]
  ) {
    if (name === "setup") {
      this.indexingFunctions._meta_ ||= {};
      this.indexingFunctions._meta_.setup =
        indexingFunction as SetupEventIndexingFunction;
      return;
    }

    const [eventSourceName, eventName] = name.split(":");
    if (!eventSourceName || !eventName) {
      this.errors.push(new Error(`Invalid event name: ${name}`));
      return;
    }

    this.indexingFunctions.eventSources[eventSourceName] ||= {};
    if (this.indexingFunctions.eventSources[eventSourceName][eventName]) {
      this.errors.push(
        new Error(`Cannot add multiple indexing functions for event: ${name}`)
      );
      return;
    }
    this.indexingFunctions.eventSources[eventSourceName][eventName] =
      indexingFunction as LogEventIndexingFunction;
  }
}

export const buildRawIndexingFunctions = async ({
  options,
}: {
  options: Options;
}) => {
  const entryAppFilename = path.join(options.generatedDir, "index.ts");
  if (!existsSync(entryAppFilename)) {
    throw new Error(
      `generated/index.ts file not found, expected: ${entryAppFilename}`
    );
  }

  const entryGlob = path.join(options.srcDir, "/**/*.ts");
  const entryFilenames = [...glob.sync(entryGlob), entryAppFilename];

  const buildDir = path.join(options.ponderDir, "out");
  rmSync(buildDir, { recursive: true, force: true });

  try {
    await build({
      entryPoints: entryFilenames,
      outdir: buildDir,
      platform: "node",
      bundle: false,
      format: "cjs",
      logLevel: "silent",
      sourcemap: "inline",
    });
  } catch (err) {
    const error = err as Error & { errors: Message[]; warnings: Message[] };
    // Hack to use esbuilds very pretty stack traces when rendering errors to the user.
    const stackTraces = formatMessagesSync(error.errors, {
      kind: "error",
      color: true,
    });
    error.stack = stackTraces.join("\n");

    throw error;
  }

  const tsconfigPath = path.join(options.rootDir, "tsconfig.json");
  if (existsSync(tsconfigPath)) {
    await replaceTscAliasPaths({
      configFile: tsconfigPath,
      outDir: buildDir,
    });
  } else {
    throw new Error(
      `tsconfig.json not found, unable to resolve "@/*" path aliases. Expected at: ${tsconfigPath}`
    );
  }

  const outGlob = buildDir + "/**/*.js";
  const outFilenames = glob.sync(outGlob);

  // Remove all out modules from the require cache, because we are loading
  // them several times in the same process and need the latest version each time.
  // https://ar.al/2021/02/22/cache-busting-in-node.js-dynamic-esm-imports/
  outFilenames.forEach((file) => delete require.cache[require.resolve(file)]);

  const outAppFilename = path.join(buildDir, "generated/index.js");

  // Require all the user-defined files first.
  const outUserFilenames = outFilenames.filter(
    (name) => name !== outAppFilename
  );

  const requireErrors = outUserFilenames
    .map((file) => {
      try {
        require(file);
        return undefined;
      } catch (err) {
        return err as Error;
      }
    })
    .filter((err): err is Error => err !== undefined);

  if (requireErrors.length > 0) {
    throw requireErrors[0];
  }

  // Then require the `_app.ts` file to grab the `app` instance.
  const result = require(outAppFilename);

  const app = result.ponder;

  if (!app) {
    throw new Error(`ponder not exported from generated/index.ts`);
  }
  if (!(app.constructor.name === "PonderApp")) {
    throw new Error(`exported ponder not instanceof PonderApp`);
  }
  if (app["errors"].length > 0) {
    const error = app["errors"][0];
    throw error;
  }

  return app["indexingFunctions"] as RawIndexingFunctions;
};

export type IndexingFunctions = {
  _meta_: {
    setup?: {
      fn: SetupEventIndexingFunction;
    };
  };
  eventSources: {
    [key: EventSourceName]: {
      // This mapping is passed from the IndexingService to the EventAggregatorService, which uses
      // it to fetch from the store _only_ the events that the user has indexed.
      bySelector: { [key: Hex]: LogEventMetadata };
      // This mapping is used by the IndexingService to fetch the user-provided `fn` before running it.
      bySafeName: {
        [key: EventName]: LogEventMetadata & { fn: LogEventIndexingFunction };
      };
    };
  };
};

export const hydrateIndexingFunctions = ({
  rawIndexingFunctions,
  logFilters,
  factories,
}: {
  rawIndexingFunctions: RawIndexingFunctions;
  logFilters: LogFilter[];
  factories: Factory[];
}) => {
  const indexingFunctions: IndexingFunctions = {
    _meta_: {},
    eventSources: {},
  };

  if (rawIndexingFunctions._meta_?.setup) {
    indexingFunctions._meta_.setup = { fn: rawIndexingFunctions._meta_.setup };
  }

  Object.entries(rawIndexingFunctions.eventSources).forEach(
    ([eventSourceName, eventSourceFunctions]) => {
      const logFilter = logFilters.find((l) => l.name === eventSourceName);
      const factory = factories.find((f) => f.name === eventSourceName);

      if (!logFilter && !factory) {
        throw new Error(`Event source not found in config: ${eventSourceName}`);
      }

      Object.entries(eventSourceFunctions).forEach(([eventName, fn]) => {
        const eventData = logFilter
          ? logFilter.events[eventName]
          : factory?.events[eventName];

        if (!eventData) {
          throw new Error(`Log event not found in ABI: ${eventName}`);
        }

        indexingFunctions.eventSources[eventSourceName] ||= {
          bySafeName: {},
          bySelector: {},
        };
        indexingFunctions.eventSources[eventSourceName].bySelector[
          eventData.selector
        ] = eventData;
        indexingFunctions.eventSources[eventSourceName].bySafeName[
          eventData.safeName
        ] = { ...eventData, fn: fn };
      });
    }
  );

  return indexingFunctions;
};
