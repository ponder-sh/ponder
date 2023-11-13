import { readFileSync, rmSync, writeFileSync } from "node:fs";

import { subgraph } from "./subgraph";

const changeMappingFileDelim = (delim: string) => {
  let mappingFileContents = readFileSync("./subgraph/src/mapping.ts", {
    encoding: "utf-8",
  });
  mappingFileContents = mappingFileContents.replace(
    /(kevin:.)/g,
    `kevin:${delim}`,
  );

  writeFileSync("./subgraph/src/mapping.ts", mappingFileContents, "utf-8");
};

const bench = async () => {
  // Reset handler delimeter
  changeMappingFileDelim("-");

  // Clear cached files
  rmSync("./ponder/.ponder/", {
    recursive: true,
    force: true,
  });
  rmSync("./ponder/generated/", {
    recursive: true,
    force: true,
  });

  const subgraphCold = await subgraph();
  console.log({ subgraphCold });

  // Force handler cache invalidation
  changeMappingFileDelim("+");

  // const subgraphHot = await subgraph();
};

await bench();
