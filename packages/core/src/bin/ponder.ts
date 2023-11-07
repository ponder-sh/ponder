#!/usr/bin/env node
import { cac } from "cac";
import dotenv from "dotenv";

import { buildOptions } from "@/config/options";
import { Ponder } from "@/Ponder";

// NOTE: This is a workaround for tsconfig `rootDir` nonsense.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import packageJson from "../../package.json";

dotenv.config({ path: ".env.local" });

const cli = cac("ponder")
  .version(packageJson.version)
  .usage("<command> [options]")
  .help()
  .option("--config-file [path]", `Path to config file`, {
    default: "ponder.config.ts",
  })
  .option("--root-dir [path]", `Path to project root directory`, {
    default: ".",
  });

export type CliOptions = {
  help?: boolean;
  configFile: string;
  rootDir: string;
};

cli
  .command("dev", "Start the development server")
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    const options = buildOptions({ cliOptions });
    const devOptions = { ...options, uiEnabled: true };

    const ponder = new Ponder({ options: devOptions });
    registerKilledProcessListener(() => ponder.kill());

    await ponder.setup();
    await ponder.dev();
  });

cli
  .command("start", "Start the production server")
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    const options = buildOptions({ cliOptions });
    const startOptions = { ...options, uiEnabled: false };

    const ponder = new Ponder({ options: startOptions });
    registerKilledProcessListener(() => ponder.kill());

    await ponder.setup();
    await ponder.start();
  });

cli
  .command("codegen", "Emit type files, then exit")
  .action(async (cliOptions: CliOptions) => {
    if (cliOptions.help) process.exit(0);

    const options = buildOptions({ cliOptions });
    const codegenOptions = {
      ...options,
      uiEnabled: false,
      logLevel: "silent" as const,
    };

    const ponder = new Ponder({ options: codegenOptions });
    registerKilledProcessListener(() => ponder.kill());

    await ponder.setup();
    await ponder.codegen();
  });

cli.parse();

function registerKilledProcessListener(fn: () => Promise<unknown>) {
  let isKillListenerInProgress = false;

  const listener = async () => {
    if (isKillListenerInProgress) return;
    isKillListenerInProgress = true;
    await fn();
    process.exit(0);
  };

  process.on("SIGINT", listener); // CTRL+C
  process.on("SIGQUIT", listener); // Keyboard quit
  process.on("SIGTERM", listener); // `kill` command
}
