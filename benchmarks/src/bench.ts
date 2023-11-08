import { rmSync } from "node:fs";

import { ponder } from "./ponder";
import { subgraph } from "./subgraph";

const bench = async () => {
  // await subgraph();

  rmSync("./ponder/.ponder/", {
    recursive: true,
    force: true,
  });
  rmSync("./ponder/generated/", {
    recursive: true,
    force: true,
  });

  const ponderCold = await ponder();
  const ponderHot = await ponder();

  console.log(ponderCold);
  console.log(ponderHot);
};

await bench();
