import { Effect } from "effect";
import { buildOptions } from "../../internal/options.js";
import type { CliOptions } from "../ponder.js";
import { runCodegen } from "../utils/codegen.js";
import { checkNodeVersion } from "../utils/command.js";
import { runMain } from "../utils/exit.js";

export function codegen({ cliOptions }: { cliOptions: CliOptions }) {
  const options = buildOptions({ cliOptions });

  runMain({
    options,
    program: Effect.gen(function* () {
      yield* checkNodeVersion;

      yield* runCodegen;

      yield* Effect.logInfo({ msg: `Wrote file "ponder-env.d.ts"` });

      return 0;
    }),
  });
}
