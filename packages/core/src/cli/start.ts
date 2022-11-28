import type { PonderCliOptions } from "@/bin/ponder";
import { readPonderConfig } from "@/cli/readPonderConfig";
import { Ponder } from "@/Ponder";

export const start = async (options: PonderCliOptions) => {
  const config = readPonderConfig(options.configFilePath);

  const ponder = new Ponder(config);

  await ponder.start();
};
