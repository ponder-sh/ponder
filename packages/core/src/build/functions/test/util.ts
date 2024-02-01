import { type Context } from "./ponder-env.js";

export const helper1 = async (context: Context) => {
  await context.db.Table1.upsert({
    id: "kyle",
  });
};

export async function helper2(context: Context) {
  await context.db.Table1.upsert({
    id: "kyle",
  });
}
