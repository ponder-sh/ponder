import { getAddress } from "viem";

import { ponder } from "@/generated";

ponder.on("WETH:Transfer", async ({ event, context }) => {
  const { Account, TransferEvent } = context.db;

  // Create an Account for the sender, or update the balance if it already exists.
  await Account.upsert({
    id: getAddress(event.args.from),
    create: {
      balance: BigInt(0),
    },
    update: ({ current }) => ({
      balance: current.balance - event.args.value,
    }),
  });

  // Create an Account for the recipient, or update the balance if it already exists.
  await Account.upsert({
    id: getAddress(event.args.to),
    create: {
      balance: event.args.value,
    },
    update: ({ current }) => ({
      balance: current.balance + event.args.value,
    }),
  });

  // Create a TransferEvent.
  await TransferEvent.create({
    id: event.log.id,
    data: {
      fromId: event.args.from,
      toId: event.args.to,
      amount: event.args.value,
      timestamp: Number(event.block.timestamp),
    },
  });
});
