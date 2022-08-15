#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const { argv } = require("yargs");

const scriptName = argv.$0;
const command = argv._[0];
const args = argv;

const commands: { [command: string]: () => Promise<(args: unknown) => void> } =
  {
    dev: () => Promise.resolve(require("../tool/dev").dev),
    // build: () => Promise.resolve(require("../cli/next-build").nextBuild),
    start: () => Promise.resolve(require("../tool/start").start),
    // deploy: () => Promise.resolve(require("../cli/next-export").nextExport),
  };

if (!Object.keys(commands).includes(command)) {
  throw new Error(`Command not found: ${command}`);
}

commands[command]().then((exec) => exec(args));
