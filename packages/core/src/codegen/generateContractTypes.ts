import { writeFileSync } from "node:fs";
import path from "node:path";

import { ensureDirExists } from "@/common/utils";
import type { Ponder } from "@/Ponder";

import { formatPrettier } from "./utils";

export const generateContractTypes = ({ ponder }: { ponder: Ponder }) => {
  ponder.contracts.forEach((contract) => {
    const raw = `
      import { ReadOnlyContract } from "@ponder/core";

      const ${contract.name}Abi = ${JSON.stringify(
      contract.abi
    ).trimEnd()} as const;

      export type ${contract.name} =
        ReadOnlyContract<typeof ${contract.name}Abi>;
    `;
    const final = formatPrettier(raw);

    const filePath = path.join(
      ponder.options.GENERATED_DIR_PATH,
      `contracts/${contract.name}.ts`
    );

    ensureDirExists(filePath);
    writeFileSync(filePath, final, "utf8");
  });
};
