import { ponder } from "./ponder";
import { subgraph } from "./subgraph";

const bench = async () => {
  // await subgraph();
  await ponder();
};

await bench();
