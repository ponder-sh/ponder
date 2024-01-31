// @ts-ignore
import { ponder } from "@/generated";

// biome-ignore lint/suspicious/noRedeclare: :)
declare const ponder: import("@ponder/core").PonderApp<
  typeof import("../ponder.config.js").default,
  typeof import("../ponder.schema.js").default
>;

ponder.on("RocketTokenRETH:Transfer", async ({ event, context }) => {
  const { Account, TransferEvent } = context.db;

  await Promise.all([
    Account.upsert({
      id: event.args.from,
      create: {
        balance: 0n,
        isOwner: false,
      },
      update: ({ current }) => ({
        balance: current.balance - event.args.value,
      }),
    }),

    event.args.from !== event.args.to
      ? Account.upsert({
          id: event.args.to,
          create: {
            balance: 0n,
            isOwner: false,
          },
          update: ({ current }) => ({
            balance: current.balance + event.args.value,
          }),
        })
      : undefined,

    TransferEvent.create({
      id: event.log.id,
      data: {
        fromId: event.args.from,
        toId: event.args.to,
        amount: event.args.value,
        timestamp: Number(event.block.timestamp),
      },
    }),
  ]);
});

ponder.on("RocketTokenRETH:Approval", async ({ event, context }) => {
  const { Allowance, ApprovalEvent } = context.db;

  const allowanceId = `${event.args.owner}-${event.args.spender}`;

  await Promise.all([
    Allowance.upsert({
      id: allowanceId,
      create: {
        ownerId: event.args.owner,
        spenderId: event.args.spender,
        amount: event.args.value,
      },
      update: {
        amount: event.args.value,
      },
    }),

    ApprovalEvent.create({
      id: event.log.id,
      data: {
        ownerId: event.args.owner,
        spenderId: event.args.spender,
        amount: event.args.value,
        timestamp: Number(event.block.timestamp),
      },
    }),
  ]);
});
