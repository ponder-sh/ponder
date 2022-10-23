import { Ponder } from "@/core/Ponder";
import { readPonderConfig } from "@/core/readPonderConfig";

export const dev = async () => {
  console.log("lick my ass");

  const config = readPonderConfig();

  const ponder = new Ponder(config);

  await ponder.dev();
};
