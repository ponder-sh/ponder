import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { OPTIONS } from "@/common/options";
import type { Source } from "@/sources/base";

export const generateContractTypes2 = (sources: Source[]) => {
  sources.forEach((source) => {
    const abiFileContents = readFileSync(source.abiFilePath, "utf-8");

    const final = `
      export default ${abiFileContents} as const;
    `;

    console.log({ abiFileContents, final });

    writeFileSync(
      path.join(OPTIONS.GENERATED_DIR_PATH, `abitype/${source.name}.ts`),
      final,
      "utf8"
    );
  });
};
