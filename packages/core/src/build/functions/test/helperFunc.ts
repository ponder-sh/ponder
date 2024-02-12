import { ponder } from "./ponder-env.js";
import { helper1 } from "./util.js";

ponder.on("C:Event1", async ({ context }) => {
  helper1({ context });
});
