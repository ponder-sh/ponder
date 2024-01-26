import { type Context, ponder } from "./ponder-env.js";

const helper = async (context: Context) => {
  await context.db.Table1.upsert({
    id: "kyle",
  });
};

ponder.on("C:Event1", async ({ context }) => {
  helper(context);
});
