import { writeFileSync } from "node:fs";
import path from "node:path";

import { OPTIONS } from "@/common/options";
import { ensureDirExists } from "@/common/utils";
import type { Source } from "@/sources/base";

import { formatPrettier } from "./utils";

export const generateContractTypes = (sources: Source[]) => {
  sources.forEach((source) => {
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
      OPTIONS.GENERATED_DIR_PATH,
      `contracts/${source.name}.ts`
    );

    ensureDirExists(filePath);
    writeFileSync(filePath, final, "utf8");
  });
};
