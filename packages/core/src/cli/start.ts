import type { PonderCliOptions } from "@/bin/ponder";
import { Ponder } from "@/Ponder";

export const start = async (options: PonderCliOptions) => {
  const ponder = new Ponder(options);

  await ponder.start();
};
