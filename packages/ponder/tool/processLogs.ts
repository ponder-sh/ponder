import { build } from "esbuild";
import { utils } from "ethers";

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

    // YAY we're running user code here!
    handler(log.args);
  }
};

export { processLogs };
