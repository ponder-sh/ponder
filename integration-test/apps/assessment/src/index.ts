import { ponder } from "ponder:registry";
import schema from "ponder:schema";
import { isAddress, zeroHash } from "viem";

ponder.on("weth9:setup", async ({ context }) => {
  await context.db.insert(schema.state).values({
    chainId: context.chain.id,
    blockNumber: BigInt(context.contracts.weth9.startBlock),
    blockHash: zeroHash,
    logIndex: 0,
    transactionHash: "0x0",
    transactionIndex: 0,
  });
});

ponder.on("weth9:Transfer", async ({ event, context }) => {
  const state = await context.db.find(schema.state, {
    chainId: context.chain.id,
  });

  if (!state) throw Error("state not found");

  if (event.block.number < state.blockNumber) {
    throw Error("invalid block number");
  } else if (event.block.number === state.blockNumber) {
    if (event.block.hash !== state.blockHash && state.blockHash !== zeroHash) {
      throw Error("invalid block hash");
    }

    if (event.transaction.transactionIndex < state.transactionIndex) {
      throw Error(
        `invalid transaction index. event:${event.transaction.transactionIndex} state:${state.transactionIndex}`,
      );
    }

    if (event.log.logIndex < state.logIndex) {
      throw Error(
        `invalid log index event:${event.log.logIndex} state:${state.logIndex}`,
      );
    }
  } else if (event.block.number === state.blockNumber + 1n) {
    if (event.block.parentHash !== state.blockHash) {
      throw Error("invalid parent block hash");
    }
  }

  if (!isAddress(event.args.from)) {
    throw Error("invalid from arg");
  }

  if (!isAddress(event.args.to)) {
    throw Error("invalid to arg");
  }

  if (typeof event.args.value !== "bigint") {
    throw Error("invalid value arg");
  }

  if (event.log.address !== context.contracts.weth9.address) {
    throw Error("invalid log address");
  }

  await context.db.update(schema.state, { chainId: context.chain.id }).set({
    blockNumber: event.block.number,
    blockHash: event.block.hash,
    logIndex: event.log.logIndex,
    transactionHash: event.transaction.hash,
    transactionIndex: event.transaction.transactionIndex,
  });
});

ponder.on("weth9.transfer()", async ({ event, context }) => {
  const state = await context.db.find(schema.state, {
    chainId: context.chain.id,
  });

  if (state!.blockNumber !== event.block.number) {
    throw Error(
      `invalid block number. state: ${state?.blockNumber} event: ${event.block.number}`,
    );
  }

  if (state!.transactionHash !== event.transaction.hash) {
    throw Error("invalid transaction hash");
  }

  if (state!.transactionIndex !== event.transaction.transactionIndex) {
    throw Error("invalid transaction index");
  }
});
