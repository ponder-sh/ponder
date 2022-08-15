import { build } from "esbuild";
import path from "node:path";

import type { HandlerContext } from "./buildHandlerContext";
import { toolConfig } from "./config";

const { userHandlersDir, buildDir } = toolConfig;

type Handler = (args: unknown, context: HandlerContext) => Promise<void> | void;
type SourceHandlers = { [eventName: string]: Handler | undefined };
type UserHandlers = { [sourceName: string]: SourceHandlers | undefined };

const readUserHandlers = async (): Promise<UserHandlers> => {
  const buildFile = path.join(buildDir, "handlers.js");

  try {
    await build({
      entryPoints: [userHandlersDir],
      outfile: buildFile,
      platform: "node",
      bundle: true,
    });
  } catch (err) {
    console.log("esbuild error:", err);
  }

  const { default: rawHandlers } = await require(buildFile);
  delete require.cache[require.resolve(buildFile)];

  // TODO: Validate handlers ?!?!?!
  const handlers = rawHandlers as UserHandlers;

  return handlers;
};

export { readUserHandlers };
export type { UserHandlers };
