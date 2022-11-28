import { writeFileSync } from "node:fs";
import path from "node:path";

import { ensureDirExists } from "@/common/utils";
import type { Ponder } from "@/Ponder";

import { formatPrettier } from "./utils";

export const generateContractTypes = ({ ponder }: { ponder: Ponder }) => {
  ponder.sources.forEach((source) => {
    const raw = `
      import { AbitypedEthersContract } from "@ponder/core";

      const ${source.name}Abi = ${JSON.stringify(
      source.abi
    ).trimEnd()} as const;

      export type ${source.name} =
        AbitypedEthersContract<typeof ${source.name}Abi>;
    `;
    const final = formatPrettier(raw);

    const filePath = path.join(
      ponder.options.GENERATED_DIR_PATH,
      `contracts/${source.name}.ts`
    );

    ensureDirExists(filePath);
    writeFileSync(filePath, final, "utf8");
  });
};
