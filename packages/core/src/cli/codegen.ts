import type { PonderCliOptions } from "@/bin/ponder";
import { Ponder } from "@/Ponder";

export const codegen = async (options: PonderCliOptions) => {
  const ponder = new Ponder(options);

  ponder.codegen();
};
