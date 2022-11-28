import type { PonderCliOptions } from "@/bin/ponder";
import { Ponder } from "@/Ponder";

export const dev = async (options: PonderCliOptions) => {
  const ponder = new Ponder(options);

  await ponder.dev();
};
