import { type Context, type Event } from "./ponder-env.js";

export const helper1 = async ({
  context,
}: {
  context: Context;
  junk?: string;
}) => {
  await context.db.Table1.upsert({
    id: "kyle",
  });
};

export async function helper2(context: Context) {
  await context.db.Table1.upsert({
    id: "kyle",
  });
}

export async function helper3({ context }: { event: Event; context: Context }) {
  await context.db.Table1.upsert({
    id: "kyle",
  });
}
