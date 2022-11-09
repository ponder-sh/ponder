import { readPonderConfig } from "@/cli/readPonderConfig";
import { Ponder } from "@/Ponder";

export const start = async () => {
  const config = readPonderConfig();

  const ponder = new Ponder(config);

  await ponder.start();
};
