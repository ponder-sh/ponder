import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { OPTIONS } from "@/common/options";
import type { Source } from "@/sources/base";

import { formatPrettier } from "./utils";

export const generateContractTypes = (sources: Source[]) => {
  sources.forEach((source) => {
    const abiFileContents = readFileSync(source.abiFilePath, "utf-8");

    const raw = `
      export default ${abiFileContents.trimEnd()} as const;
    `;
    const final = formatPrettier(raw);

    const abiTsFileName = path.join(
      OPTIONS.GENERATED_DIR_PATH,
      `abitype/${source.name}.ts`
    );

    mkdirSync(path.dirname(abiTsFileName), { recursive: true });
    writeFileSync(abiTsFileName, final, "utf8");
  });
};
