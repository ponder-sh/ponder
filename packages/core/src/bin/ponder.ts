#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

import { Command } from "commander";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const program = new Command();

program
  .command("dev")
  .description("start local development server")
  .action(() => {
    require("../cli/dev").dev();
  });

program
  .command("start")
  .description("start server")
  .action(() => {
    require("../cli/start").start();
  });

program
  .command("codegen")
  .description("start local development server")
  .action(() => {
    require("../cli/codegen").codegen();
  });

program.parse();
