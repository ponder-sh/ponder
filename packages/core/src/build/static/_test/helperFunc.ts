import { ponder } from "./ponder-env.js";
import { helper1, helper2, helper3 } from "./util.js";

ponder.on("C:Event1", async ({ context }) => {
  await helper1({ context });
});

ponder.on("C:Event2", async ({ context }) => {
  await helper2(context);
});

ponder.on("C:Event3", helper3);
