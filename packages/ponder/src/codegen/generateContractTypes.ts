import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { OPTIONS } from "@/common/options";
import type { Source } from "@/sources/base";

import { formatPrettier } from "./utils";

export const generateContractTypes = (sources: Source[]) => {
  mkdirSync(path.join(OPTIONS.GENERATED_DIR_PATH, `contracts`), {
    recursive: true,
  });

  sources.forEach((source) => {
    const abiFileContents = readFileSync(source.abiFilePath, "utf-8");

    const raw = `
      import { AbitypedEthersContract } from "@ponder/ponder";

      const ${source.name}Abi = ${abiFileContents.trimEnd()} as const;

      export type ${source.name} =
        AbitypedEthersContract<typeof ${source.name}Abi>;
    `;
    const final = formatPrettier(raw);

    const abiTsFileName = path.join(
      OPTIONS.GENERATED_DIR_PATH,
      `contracts/${source.name}.ts`
    );

    writeFileSync(abiTsFileName, final, "utf8");
  });

  // Now, create an `index.ts` file that exports each source's contract type.
  const contractNames = sources.map((source) => source.name);

  const raw = `
    ${contractNames
      .map((name) => `export { ${name} } from './${name}';`)
      .join(" ")}
  `;
  const final = formatPrettier(raw);

  writeFileSync(
    path.join(OPTIONS.GENERATED_DIR_PATH, `contracts/index.ts`),
    final,
    "utf8"
  );
};
