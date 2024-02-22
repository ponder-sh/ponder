import { ponder } from "./ponder-env.js";
import { HelperObject } from "./util.js";

ponder.on("C:Event1", async ({ event, context }) => {
  await HelperObject.helper({ context, event });
});
