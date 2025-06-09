import { ponder } from "ponder:registry";
import schema from "ponder:schema";

ponder.on("BasePaintBrush:Transfer", async ({ event, context }) => {
  const { BasePaintBrush } = context.contracts;

  const strength = await context.client
    .readContract({
      abi: BasePaintBrush.abi,
      address: BasePaintBrush.address,
      functionName: "strengths",
      args: [event.args.tokenId],
    })
    .then(Number);

  await context.db
    .insert(schema.brush)
    .values({
      id: Number(event.args.tokenId),
      ownerId: event.args.to,
      strength,
      streak: 0,
      strengthRemaining: strength,
    })
    .onConflictDoUpdate({
      ownerId: event.args.to,
      strength,
    });

  const account = await context.db.find(schema.account, {
    address: event.args.to,
  });

  if (account === null) {
    await context.db
      .insert(schema.account)
      .values({ address: event.args.to, totalPixels: 0 });
  }
});
