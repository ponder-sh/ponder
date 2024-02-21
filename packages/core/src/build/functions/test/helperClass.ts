import { ponder } from "./ponder-env.js";
import { HelperClass } from "./util.js";

ponder.on("C:Event1", async ({ event, context }) => {
  const helper = new HelperClass();
  await helper.helper({ context, event });
});
