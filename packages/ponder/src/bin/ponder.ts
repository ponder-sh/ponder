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
  .command("dev-subgraph")
  .description("start local development server for Graph Protocol subgraph")
  .action(() => {
    require("../cli/dev-subgraph").dev();
  });

program
  .command("start-subgraph")
  .description("start server for Graph Protocol subgraph")
  .action(() => {
    require("../cli/start-subgraph").start();
  });

program.parse();
