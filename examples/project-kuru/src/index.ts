import { ponder } from "ponder:registry";
import { cancelEvent, order, trade } from "ponder:schema";

ponder.on("KuruOrderBook:Trade", async ({ event, context }) => {
  await context.db.insert(trade).values({
    id: event.id,
    orderId: Number(event.args.orderId),
    maker: event.args.makerAddress,
    taker: event.args.takerAddress,
    txOrigin: event.args.txOrigin,
    isBuy: event.args.isBuy,
    price: event.args.price,
    filledSize: BigInt(event.args.filledSize),
    updatedSize: BigInt(event.args.updatedSize),
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("KuruOrderBook:OrderCreated", async ({ event, context }) => {
  await context.db.insert(order).values({
    orderId: Number(event.args.orderId),
    owner: event.args.owner,
    size: BigInt(event.args.size),
    price: Number(event.args.price),
    isBuy: event.args.isBuy,
    isCanceled: false,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("KuruOrderBook:OrdersCanceled", async ({ event, context }) => {
  await context.db.insert(cancelEvent).values({
    id: event.id,
    orderIds: event.args.orderId.map(Number).join(","),
    owner: event.args.owner,
    timestamp: Number(event.block.timestamp),
  });

  for (const id of event.args.orderId) {
    await context.db
      .insert(order)
      .values({
        orderId: Number(id),
        owner: event.args.owner,
        size: 0n,
        price: 0,
        isBuy: false,
        isCanceled: true,
        timestamp: Number(event.block.timestamp),
      })
      .onConflictDoUpdate({ isCanceled: true });
  }
});

ponder.on("KuruOrderBook:FlipOrderCreated", async ({ event, context }) => {
  await context.db.insert(order).values({
    orderId: Number(event.args.orderId),
    owner: event.args.owner,
    size: BigInt(event.args.size),
    price: Number(event.args.price),
    isBuy: event.args.isBuy,
    isCanceled: false,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("KuruOrderBook:FlippedOrderCreated", async ({ event, context }) => {
  await context.db.insert(order).values({
    orderId: Number(event.args.orderId),
    owner: event.args.owner,
    size: BigInt(event.args.size),
    price: Number(event.args.price),
    isBuy: event.args.isBuy,
    isCanceled: false,
    timestamp: Number(event.block.timestamp),
  });
});

ponder.on("KuruOrderBook:FlipOrderUpdated", async ({ event, context }) => {
  await context.db
    .insert(order)
    .values({
      orderId: Number(event.args.orderId),
      owner: "0x0000000000000000000000000000000000000000",
      size: BigInt(event.args.size),
      price: 0,
      isBuy: false,
      isCanceled: false,
      timestamp: Number(event.block.timestamp),
    })
    .onConflictDoUpdate({ size: BigInt(event.args.size) });
});

ponder.on("KuruOrderBook:FlipOrdersCanceled", async ({ event, context }) => {
  await context.db.insert(cancelEvent).values({
    id: event.id,
    orderIds: event.args.orderIds.map(Number).join(","),
    owner: event.args.owner,
    timestamp: Number(event.block.timestamp),
  });

  for (const id of event.args.orderIds) {
    await context.db
      .insert(order)
      .values({
        orderId: Number(id),
        owner: event.args.owner,
        size: 0n,
        price: 0,
        isBuy: false,
        isCanceled: true,
        timestamp: Number(event.block.timestamp),
      })
      .onConflictDoUpdate({ isCanceled: true });
  }
});
