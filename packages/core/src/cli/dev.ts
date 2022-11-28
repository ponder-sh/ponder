import type { PonderCliOptions } from "@/bin/ponder";
import { readPonderConfig } from "@/cli/readPonderConfig";
import { Ponder } from "@/Ponder";

export const dev = async (options: PonderCliOptions) => {
  const config = readPonderConfig(options.configFilePath);

  const ponder = new Ponder(config);

  await ponder.dev();
};
