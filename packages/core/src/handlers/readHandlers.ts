import { build, formatMessagesSync, Message } from "esbuild";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { ensureDirExists } from "@/common/utils";
import type { Ponder } from "@/Ponder";
import type { Block, EventLog, Transaction } from "@/types";

export interface HandlerEvent extends EventLog {
  name: string;
  block: Block;
  transaction: Transaction;
}

export type Handler = (
  event: HandlerEvent,
  context: unknown
) => Promise<void> | void;
export type SourceHandlers = Record<string, Handler | undefined>;
export type Handlers = Record<string, SourceHandlers | undefined>;

export const readHandlers = async ({ ponder }: { ponder: Ponder }) => {
  const buildFile = path.join(ponder.options.PONDER_DIR_PATH, "handlers.js");
  ensureDirExists(buildFile);

  const handlersRootFilePath = path.join(
    ponder.options.HANDLERS_DIR_PATH,
    "index.ts"
  );

  if (!existsSync(handlersRootFilePath)) {
    ponder.emit("dev_error", {
      context: `reading handler files`,
      error: new Error(
        `Handlers not found, expected file: ${handlersRootFilePath}`
      ),
    });
    return null;
  }

  // Delete the build file before attempted to write it. This fixes a bug where a file
  // inside handlers/ gets renamed, the build fails, but the stale `handlers.js` file remains.
  rmSync(buildFile, { force: true });

  try {
    await build({
      entryPoints: [handlersRootFilePath],
      outfile: buildFile,
      platform: "node",
      bundle: true,
      logLevel: "silent",
    });
  } catch (err) {
    const error = err as Error & { errors: Message[]; warnings: Message[] };
    // Hack to use esbuilds very pretty stack traces when rendering errors to the user.
    const stackTraces = formatMessagesSync(error.errors, {
      kind: "error",
      color: true,
    });
    error.stack = stackTraces.join("\n");

    ponder.emit("dev_error", {
      context: `building handler files`,
      error,
    });

    return null;
  }

  // Load and then remove the module from the require cache, because we are loading
  // it several times in the same process and need the latest version each time.
  // https://ar.al/2021/02/22/cache-busting-in-node.js-dynamic-esm-imports/
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { default: rawHandlers } = require(buildFile);
  delete require.cache[require.resolve(buildFile)];

  // TODO: Validate handlers ?!?!?!
  const handlers = rawHandlers as Handlers;

  return handlers;
};
