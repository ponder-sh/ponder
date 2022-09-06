#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import { Command } from "commander";

const program = new Command();

program
  .command("dev")
  .description("start local development server")
  .action(() => {
    require("../index").run();
  });

program.parse();
