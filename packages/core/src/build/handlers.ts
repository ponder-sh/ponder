import { type Message, build, formatMessagesSync } from "esbuild";
import glob from "glob";
import { existsSync, rmSync } from "node:fs";
import * as path from "node:path";
import { replaceTscAliasPaths } from "tsc-alias";
import type { Hex } from "viem";

import type { LogEventMetadata, LogFilter } from "@/config/logFilters.js";
import type { Options } from "@/config/options.js";
import type { Block } from "@/types/block.js";
import type { Log } from "@/types/log.js";
import type { Transaction } from "@/types/transaction.js";

export interface LogEvent {
  name: string;
  params: Record<string, any>;
  log: Log;
  block: Block;
  transaction: Transaction;
}

export type LogFilterName = string;
export type LogEventName = string;
type LogEventHandlerFunction = ({
  event,
  context,
}: {
  event: LogEvent;
  context: unknown;
}) => Promise<void> | void;

type SetupEventHandlerFunction = ({
  context,
}: {
  context: unknown;
}) => Promise<void> | void;

type RawHandlerFunctions = {
  _meta_?: {
    setup?: SetupEventHandlerFunction;
  };
  logFilters: {
    [key: LogFilterName]: {
      [key: LogEventName]: LogEventHandlerFunction;
    };
  };
};

// @ponder/core creates an instance of this class called `ponder`
export class PonderApp<
  EventHandlers = Record<string, LogEventHandlerFunction>
> {
  private handlerFunctions: RawHandlerFunctions = { logFilters: {} };
  private errors: Error[] = [];

  on<EventName extends Extract<keyof EventHandlers, string>>(
    name: EventName,
    handler: EventHandlers[EventName]
  ) {
    if (name === "setup") {
      this.handlerFunctions._meta_ ||= {};
      this.handlerFunctions._meta_.setup = handler as SetupEventHandlerFunction;
      return;
    }

    const [logFilterName, eventName] = name.split(":");
    if (!logFilterName || !eventName) {
      this.errors.push(new Error(`Invalid event name: ${name}`));
      return;
    }

    this.handlerFunctions.logFilters[logFilterName] ||= {};
    if (this.handlerFunctions.logFilters[logFilterName][eventName]) {
      this.errors.push(
        new Error(`Cannot add multiple handler functions for event: ${name}`)
      );
      return;
    }
    this.handlerFunctions.logFilters[logFilterName][eventName] =
      handler as LogEventHandlerFunction;
  }
}

export const buildRawHandlerFunctions = async ({
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

  const entryGlob = options.srcDir + "/**/*.ts";
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

  const handlers = app["handlerFunctions"] as RawHandlerFunctions;

  return handlers;
};

export type HandlerFunctions = {
  _meta_: {
    setup?: {
      fn: SetupEventHandlerFunction;
    };
  };
  logFilters: {
    [key: LogFilterName]: {
      // This mapping is passed from the EventHandlerService to the EventAggregatorService, which uses
      // it to fetch from the store _only_ the events that the user has handled.
      bySelector: { [key: Hex]: LogEventMetadata };
      // This mapping is used by the EventHandlerService to fetch the user-provided `fn` before running it.
      bySafeName: {
        [key: LogEventName]: LogEventMetadata & { fn: LogEventHandlerFunction };
      };
    };
  };
};

export const hydrateHandlerFunctions = ({
  rawHandlerFunctions,
  logFilters,
}: {
  rawHandlerFunctions: RawHandlerFunctions;
  logFilters: LogFilter[];
}) => {
  const handlerFunctions: HandlerFunctions = {
    _meta_: {},
    logFilters: {},
  };

  if (rawHandlerFunctions._meta_?.setup) {
    handlerFunctions._meta_.setup = { fn: rawHandlerFunctions._meta_.setup };
  }

  Object.entries(rawHandlerFunctions.logFilters).forEach(
    ([logFilterName, logFilterEventHandlerFunctions]) => {
      const logFilter = logFilters.find((l) => l.name === logFilterName);
      if (!logFilter) {
        throw new Error(`Log filter not found in config: ${logFilterName}`);
      }

      Object.entries(logFilterEventHandlerFunctions).forEach(
        ([logEventName, fn]) => {
          const eventData = logFilter.events[logEventName];
          if (!eventData) {
            throw new Error(`Log event not found in ABI: ${logEventName}`);
          }

          handlerFunctions.logFilters[logFilterName] ||= {
            bySafeName: {},
            bySelector: {},
          };
          handlerFunctions.logFilters[logFilterName].bySelector[
            eventData.selector
          ] = eventData;
          handlerFunctions.logFilters[logFilterName].bySafeName[
            eventData.safeName
          ] = { ...eventData, fn: fn };
        }
      );
    }
  );

  return handlerFunctions;
};
