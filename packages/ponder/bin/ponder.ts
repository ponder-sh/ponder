#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-var-requires */

// import yargs from "yargs";

// const args = yargs(process.argv.slice(2))
//   .usage("$0 <cmd> [args]")
//   .command(
//     "dev",
//     "Start the development server and indexer",
//     (yargs) => {
//       yargs.positional("name", {
//         type: "string",
//         default: "Cambi",
//         describe: "the name to say hello to",
//       });
//     }
//     // (argv) => {
//     //   console.log("hello", argv.name, "welcome to yargs!");
//     // }
//   )
//   .help().argv;

const command = "dev";
const args = {};

const commands: { [command: string]: () => Promise<(args: unknown) => void> } =
  {
    dev: () => Promise.resolve(require("../tool/dev").dev),
    // build: () => Promise.resolve(require("../cli/next-build").nextBuild),
    // start: () => Promise.resolve(require("../cli/next-start").nextStart),
    // deploy: () => Promise.resolve(require("../cli/next-export").nextExport),
  };

if (!Object.keys(commands).includes(command)) {
  throw new Error(`Command not found: ${command}`);
}

commands[command]().then((exec) => exec(args));
// .then(() => {
//   if (command === "build") {
//     process.exit(0);
//   }
// });
