import { ponder } from "@/generated";

ponder.on("ERC4626:Deposit", async ({ event, context }) => {
  // keep assets and shares count for account
  const { Account, DepositEvent } = context.db;
  const { sender, receiver, assets, shares } = event.args;

  // Create an Account for the sender, or update the balance if it already exists.
  await Account.upsert({
    id: sender,
    create: {
      assetsBalance: BigInt(0),
      sharesBalance: BigInt(0),
    },
    update: ({ current }) => ({
      assetsBalance: current.assetsBalance - assets,
      sharesBalance: current.sharesBalance - shares,
    }),
  });

  await Account.upsert({
    id: receiver,
    create: {
      assetsBalance: BigInt(assets),
      sharesBalance: BigInt(shares),
    },
    update: ({ current }) => ({
      assetsBalance: current.assetsBalance + assets,
      sharesBalance: current.sharesBalance + shares,
    }),
  });

  await DepositEvent.create({
    id: event.log.id,
    data: {
      sender: sender,
      receiver: receiver,
      assets: assets,
      shares: shares,
    },
  });
});

ponder.on("ERC4626:Withdraw", async ({ event, context }) => {
  const { Account, WithdrawEvent } = context.db;
  const { sender, receiver, owner, assets, shares } = event.args;

  // Create an Account for the sender, or update the balance if it already exists.
  await Account.upsert({
    id: sender,
    create: {
      assetsBalance: BigInt(0),
      sharesBalance: BigInt(0),
    },
    update: ({ current }) => ({
      assetsBalance: current.assetsBalance - assets,
      sharesBalance: current.sharesBalance - shares,
    }),
  });

  await Account.upsert({
    id: receiver,
    create: {
      assetsBalance: BigInt(assets),
      sharesBalance: BigInt(shares),
    },
    update: ({ current }) => ({
      assetsBalance: current.assetsBalance + assets,
      sharesBalance: current.sharesBalance + shares,
    }),
  });

  await WithdrawEvent.create({
    id: event.log.id,
    data: {
      sender: sender,
      receiver: receiver,
      owner: owner,
      assets: assets,
      shares: shares,
    },
  });
});
