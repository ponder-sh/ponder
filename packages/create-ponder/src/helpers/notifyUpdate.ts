import pico from "picocolors";
import checkForUpdate from "update-check";

import packageJson from "../../package.json" assert { type: "json" };
import type { CLIOptions } from "../index.js";
import { getPackageManager } from "./getPackageManager.js";

const log = console.log;

export async function notifyUpdate({ options }: { options: CLIOptions }) {
  try {
    const res = await checkForUpdate.default(packageJson);
    if (res?.latest) {
      const packageManager = await getPackageManager({ options });
      const updateMessage =
        packageManager === "pnpm"
          ? "pnpm add -g create-ponder"
          : packageManager === "yarn"
            ? "yarn global add create-ponder"
            : "npm i -g create-ponder";

      log(
        pico.bold(
          pico.yellow("A new version of `create-ponder` is available!") +
            "\n" +
            "You can update by running: " +
            pico.cyan(updateMessage) +
            "\n",
        ),
      );
    }
    process.exit();
  } catch {
    // ignore error
  }
}
