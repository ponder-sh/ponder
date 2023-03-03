import { build, formatMessagesSync, Message } from "esbuild";
import glob from "glob";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";

import { PonderOptions } from "@/common/options";
import type { Block, Log, Transaction } from "@/types";

export interface HandlerEvent {
  name: string;
  params: Record<string, any>;
  log: Log;
  block: Block;
  transaction: Transaction;
}

export type Handler = ({
  event,
  context,
}: {
  event: HandlerEvent;
  context: unknown;
}) => Promise<void> | void;
export type ContractHandlers = Record<string, Handler | undefined>;
export type Handlers = Record<string, ContractHandlers | undefined>;

// @ponder/core creates an instance of this class called `ponder`
export class PonderApp<HandlersType = Record<string, any>> {
  private handlers: Record<string, Record<string, any>> = {};
  private errors: Error[] = [];

  on<HandlerName extends Extract<keyof HandlersType, string>>(
    name: HandlerName,
    handler: HandlersType[HandlerName]
  ) {
    const [contractName, eventName] = name.split(":");

    if (!contractName || !eventName) {
      this.errors.push(new Error(`Invalid event name: ${name}`));
      return;
    }

    if (!this.handlers[contractName]) this.handlers[contractName] = {};

    if (this.handlers[contractName][eventName]) {
      this.errors.push(
        new Error(`Cannot add multiple handlers for event: ${name}`)
      );
      return;
    }

    this.handlers[contractName][eventName] = handler;
  }
}

export const readHandlers = async ({ options }: { options: PonderOptions }) => {
  const entryAppFilename = path.join(options.GENERATED_DIR_PATH, "index.ts");
  if (!existsSync(entryAppFilename)) {
    throw new Error(
      `generated/index.ts file not found, expected: ${entryAppFilename}`
    );
  }

  const entryGlob = options.SRC_DIR_PATH + "/**/*.ts";
  const entryFilenames = [...glob.sync(entryGlob), entryAppFilename];

  const buildDir = path.join(options.PONDER_DIR_PATH, "out");
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
  if (!(app instanceof PonderApp)) {
    throw new Error(`ponder not exported from generated/index.ts`);
  }
  if (app["errors"].length > 0) {
    const error = app["errors"][0];
    throw error;
  }

  const handlers = app["handlers"] as Handlers;

  return handlers;
};
