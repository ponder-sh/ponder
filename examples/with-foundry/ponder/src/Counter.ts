import { ponder } from "@/generated";

ponder.on("Counter:Incremented", async ({ event, context }) => {
  const { Counter } = context.db;
  await Counter.create({
    id: Number(event.args.value),
    data: {
      value: Number(event.args.value),
      block: Number(event.block.number),
    },
  });
});
