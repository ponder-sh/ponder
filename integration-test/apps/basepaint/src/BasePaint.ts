import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { zeroAddress } from "viem";

ponder.on("BasePaint:setup", async ({ context }) => {
  await context.db
    .insert(schema.global)
    .values({ id: 1, startedAt: 0, epochDuration: 0 });
});

ponder.on("BasePaint:Started", async ({ event, context }) => {
  const epochDuration = await context.client.readContract({
    abi: context.contracts.BasePaint.abi,
    address: context.contracts.BasePaint.address,
    functionName: "epochDuration",
  });

  await context.db.update(schema.global, { id: 1 }).set({
    startedAt: Number(event.block.timestamp),
    epochDuration: Number(epochDuration),
  });
});

ponder.on("BasePaint:Painted", async ({ event, context }) => {
  const day = Number(event.args.day);
  const pixelsContributed = Math.floor((event.args.pixels.length - 2) / 6);

  const canvas = await context.db.find(schema.canvas, { day });
  const brush = await context.db.find(schema.brush, {
    id: Number(event.args.tokenId),
  });

  if (brush) {
    let streak = brush.streak;

    if (brush.lastUsedDay === Number(event.args.day) - 1) {
      streak += 1;
    }
    if (
      brush.lastUsedDay == null ||
      brush.lastUsedDay < Number(event.args.day) - 1
    ) {
      streak = 1;
    }

    await context.db
      .update(schema.brush, { id: Number(event.args.tokenId) })
      .set({
        lastUsedDay: Number(event.args.day),
        lastUsedTimestamp: Number(event.block.timestamp),
        strengthRemaining: brush.strengthRemaining - pixelsContributed,
        streak,
      });
  }

  const contribution = await context.db.find(schema.contribution, {
    day: Number(event.args.day),
    accountId: event.args.author,
  });

  await context.db
    .insert(schema.contribution)
    .values({
      day: Number(event.args.day),
      accountId: event.args.author,
      canvasId: day,
      pixelsCount: pixelsContributed,
    })
    .onConflictDoUpdate((row) => ({
      pixelsCount: row.pixelsCount + pixelsContributed,
    }));

  await context.db
    .insert(schema.canvas)
    .values({
      day,
      totalMints: 0,
      totalEarned: 0n,
      pixelsCount: pixelsContributed,
      totalArtists: 1,
    })
    .onConflictDoUpdate({
      pixelsCount: (canvas?.pixelsCount ?? 0) + pixelsContributed,
      totalArtists: contribution
        ? canvas?.totalArtists
        : (canvas?.totalArtists ?? 0) + 1,
    });

  await context.db
    .insert(schema.usage)
    .values({
      day,
      tokenId: Number(event.args.tokenId),
      canvasId: day,
      brushId: Number(event.args.tokenId),
      pixelsCount: pixelsContributed,
    })
    .onConflictDoUpdate((row) => ({
      pixelsCount: row.pixelsCount + pixelsContributed,
    }));

  await context.db
    .update(schema.account, { address: event.args.author })
    .set((row) => ({
      totalPixels: row.totalPixels + pixelsContributed,
    }));

  await context.db.insert(schema.stroke).values({
    id: event.id,
    canvasId: day,
    accountId: event.args.author,
    brushId: Number(event.args.tokenId),
    data: event.args.pixels,
    tx: event.transaction.hash,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("BasePaint:ArtistsEarned", async ({ event, context }) => {
  await context.db
    .update(schema.canvas, { day: Number(event.args.day) })
    .set((row) => ({
      totalEarned: row.totalEarned + event.args.amount,
    }));
});

ponder.on("BasePaint:ArtistWithdraw", async ({ event, context }) => {
  await context.db.insert(schema.withdrawal).values({
    day: Number(event.args.day),
    accountId: event.args.author,
    canvasId: Number(event.args.day),
    amount: event.args.amount,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("BasePaint:TransferSingle", async ({ event, context }) => {
  if (event.args.from === zeroAddress) {
    await context.db
      .update(schema.canvas, { day: Number(event.args.id) })
      .set((row) => ({
        totalMints: row.totalMints + Number(event.args.value),
      }));
  }
});

ponder.on("BasePaint:TransferBatch", async ({ event, context }) => {
  for (let i = 0; i < event.args.ids.length; i++) {
    if (event.args.from === zeroAddress) {
      const id = event.args.ids[i];
      const value = event.args.values[i];
      await context.db
        .update(schema.canvas, { day: Number(id) })
        .set((row) => ({
          totalMints: row.totalMints + Number(value),
        }));
    }
  }
});
