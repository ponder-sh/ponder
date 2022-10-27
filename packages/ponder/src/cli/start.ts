import { Ponder } from "@/core/Ponder";
import { readPonderConfig } from "@/core/readPonderConfig";

export const start = async () => {
  const config = readPonderConfig();

  const ponder = new Ponder(config);

  await ponder.start();
};
