import { ponder } from "./ponder-env.js";
import { helperNest } from "./util.js";

ponder.on("C:Event1", async ({ context }) => {
  await helperNest(context);
});
