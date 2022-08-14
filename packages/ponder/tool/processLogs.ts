import { build } from "esbuild";
import type { utils } from "ethers";

import type { HandlerContext } from "./buildHandlerContext";

const processLogs = async (
  logs: utils.LogDescription[],
  handlerContext: HandlerContext
) => {
  // TODO: handle cases where this doesn't build properly...?
  await build({
    entryPoints: ["./handlers/index"],
    outfile: "./build/handlers.js",
    platform: "node",
    bundle: true,
  });
  const { default: handlers } = await require("../build/handlers.js");

  for (const log of logs) {
    const handler = handlers[log.name];

    if (!handler) {
      console.log(`Warning: Unhandled event '${log.name}'`);
      continue;
    }

    const params = { ...log.args };

    // YAY we're running user code here!
    await handler(params, handlerContext);
  }
};

export { processLogs };
