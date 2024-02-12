import { ponder } from "./ponder-env.js";
import { helper1 as helper } from "./util.js";

ponder.on("C:Event1", async ({ context }) => {
  helper({ context });
});
