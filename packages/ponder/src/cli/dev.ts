import { Ponder } from "@/core/Ponder";
import { readPonderConfig } from "@/core/readPonderConfig";

export const dev = async () => {
  const config = readPonderConfig();

  const ponder = new Ponder(config);

  await ponder.dev();
};
