import { build } from "esbuild";
import { utils } from "ethers";

import { db } from "./db";

const processLogs = async (logs: utils.LogDescription[]) => {
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
    const context = { db: db };

    // YAY we're running user code here!
    await handler(params, context);
  }
};

export { processLogs };
