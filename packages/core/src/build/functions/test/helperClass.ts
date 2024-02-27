import { ponder } from "./ponder-env.js";
import { HelperClass } from "./util.js";

ponder.on("C:Event1", async ({ event, context }) => {
  const h = new HelperClass();
  await h.helper({ context, event });
});
