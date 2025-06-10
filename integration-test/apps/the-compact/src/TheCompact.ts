import { type Context, ponder } from "ponder:registry";
import schema from "ponder:schema";
import { type Address, erc20Abi, zeroAddress } from "viem";

// Reset period values in seconds
const ResetPeriod = {
  OneSecond: 1,
  FifteenSeconds: 15,
  OneMinute: 60,
  TenMinutes: 600,
  OneHourAndFiveMinutes: 3900,
  OneDay: 86400,
  SevenDaysAndOneHour: 612000,
  ThirtyDays: 2592000,
};

enum Scope {
  Multichain = 0,
  ChainSpecific = 1,
}

const insertTokenIfNotExists = async ({
  address,
  chainId,
  timestamp,
  context,
}: {
  address: Address;
  chainId: bigint;
  timestamp: bigint;
  context: Context;
}) => {
  const existingToken = await context.db.find(schema.depositedToken, {
    tokenAddress: address,
    chainId,
  });

  if (existingToken) return existingToken;

  if (address === zeroAddress) {
    return await context.db.insert(schema.depositedToken).values({
      tokenAddress: address,
      chainId,
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
      firstSeenAt: timestamp,
      totalSupply: 0n,
    });
  } else {
    const [nameResult, symbolResult, decimalsResult] =
      await context.client.multicall({
        contracts: [
          {
            abi: erc20Abi,
            address,
            functionName: "name",
          },
          {
            abi: erc20Abi,
            address,
            functionName: "symbol",
          },
          {
            abi: erc20Abi,
            address,
            functionName: "decimals",
          },
        ],
      });

    return await context.db.insert(schema.depositedToken).values({
      tokenAddress: address,
      chainId,
      name: nameResult?.result ?? `Unknown Token (${address})`,
      symbol: symbolResult?.result ?? "???",
      decimals: decimalsResult.result ?? 18,
      firstSeenAt: timestamp,
      totalSupply: 0n,
    });
  }
};

// Unified event handlers for all chains
ponder.on("TheCompact:AllocatorRegistered", async ({ event, context }) => {
  const { allocator, allocatorId } = event.args;
  const chainId = BigInt(context.chain.id);

  // Insert into allocatorLookup table
  await context.db.insert(schema.allocatorLookup).values({
    allocatorId: BigInt(allocatorId),
    chainId,
    allocatorAddress: allocator,
  });

  await context.db
    .insert(schema.allocator)
    .values({
      address: allocator,
    })
    .onConflictDoNothing();

  await context.db.insert(schema.allocatorRegistration).values({
    allocatorAddress: allocator,
    chainId,
    registeredAt: event.block.timestamp,
  });

  await context.db.insert(schema.allocatorChainId).values({
    allocatorAddress: allocator,
    allocatorId: BigInt(allocatorId),
    chainId: BigInt(chainId),
    firstSeenAt: event.block.timestamp,
  });
});

ponder.on("TheCompact:Transfer", async ({ event, context }) => {
  const { from, to, id, amount } = event.args;
  const chainId = BigInt(context.chain.id);
  const transferAmount = BigInt(amount);

  // Extract token address from the last 160 bits of the ID
  const tokenAddress = `0x${id
    .toString(16)
    .padStart(64, "0")
    .slice(-40)}` as const;

  // Handle mints and burns
  const isMint = from === zeroAddress;
  const isBurn = to === zeroAddress;

  // Extract reset period and scope from id
  const resetPeriodIndex = Number((id >> 252n) & 0x7n);
  const scope = Number((id >> 255n) & 0x1n);
  const resetPeriod = Object.values(ResetPeriod)[resetPeriodIndex]!;
  const isMultichain = scope === Scope.Multichain;

  const allocatorId = (id >> 160n) & ((1n << 92n) - 1n);

  const allocatorMapping = await context.db.find(schema.allocatorLookup, {
    allocatorId,
    chainId,
  });

  const allocatorAddress = allocatorMapping!.allocatorAddress;

  const existingToken = await insertTokenIfNotExists({
    address: tokenAddress,
    chainId,
    timestamp: event.block.timestamp,
    context,
  });

  const existingLock = await context.db.find(schema.resourceLock, {
    lockId: id,
    chainId,
  });

  if (isMint) {
    await context.db
      .update(schema.depositedToken, { tokenAddress, chainId })
      .set((row) => ({
        totalSupply: row.totalSupply + transferAmount,
      }));

    if (!existingLock) {
      await context.db.insert(schema.resourceLock).values({
        lockId: id,
        chainId,
        tokenAddress,
        allocatorAddress,
        resetPeriod: BigInt(resetPeriod),
        isMultichain: isMultichain,
        mintedAt: event.block.timestamp,
        totalSupply: transferAmount,
        name: `Compact ${existingToken.name}`,
        symbol: `🤝-${existingToken.symbol}`,
        decimals: existingToken.decimals,
      });
    } else {
      await context.db
        .update(schema.resourceLock, { lockId: id, chainId })
        .set({
          totalSupply: existingLock.totalSupply + transferAmount,
        });
    }
  } else if (isBurn) {
    if (existingToken && existingLock) {
      await context.db
        .update(schema.depositedToken, {
          tokenAddress,
          chainId,
        })
        .set({
          totalSupply: existingToken.totalSupply - transferAmount,
        });

      await context.db
        .update(schema.resourceLock, { lockId: id, chainId: chainId })
        .set({
          totalSupply: existingLock.totalSupply - transferAmount,
        });
    }
  }

  // Update sender balances (unless minting)
  if (!isMint) {
    // Ensure sender account exists
    await context.db
      .insert(schema.account)
      .values({
        address: from,
      })
      .onConflictDoNothing();

    // Update token-level balance
    const existingFromTokenBalance = await context.db.find(
      schema.accountTokenBalance,
      { accountAddress: from, tokenAddress, chainId },
    );

    // Note: is it an invariant that `existingFromTokenBalance` and `existingFromResourceLockBalance` are always defined?

    if (existingFromTokenBalance) {
      await context.db
        .update(schema.accountTokenBalance, {
          accountAddress: from,
          tokenAddress,
          chainId,
        })
        .set({
          balance: existingFromTokenBalance.balance - transferAmount,
          lastUpdatedAt: event.block.timestamp,
        });
    }

    // Update resource lock balance
    const existingFromResourceLockBalance = await context.db.find(
      schema.accountResourceLockBalance,
      { accountAddress: from, resourceLock: id, chainId },
    );

    if (existingFromResourceLockBalance) {
      await context.db
        .update(schema.accountResourceLockBalance, {
          accountAddress: from,
          resourceLock: id,
          chainId,
        })
        .set({
          balance: existingFromResourceLockBalance.balance - transferAmount,
          lastUpdatedAt: event.block.timestamp,
        });
    }

    // Insert delta
    await context.db.insert(schema.accountDelta).values({
      id: `${event.id}-from`,
      address: from,
      counterparty: to,
      tokenAddress,
      resourceLock: id,
      chainId,
      delta: -transferAmount,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
    });
  }

  // Update receiver balances (unless burning)
  if (!isBurn) {
    // Ensure receiver account exists
    await context.db
      .insert(schema.account)
      .values({
        address: to,
      })
      .onConflictDoNothing();

    // Update token-level balance

    await context.db
      .insert(schema.accountTokenBalance)
      .values({
        accountAddress: to,
        tokenAddress,
        chainId,
        balance: transferAmount,
        lastUpdatedAt: event.block.timestamp,
      })
      .onConflictDoUpdate((row) => ({
        balance: row.balance + transferAmount,
        lastUpdatedAt: event.block.timestamp,
      }));

    // Update resource lock balance
    await context.db
      .insert(schema.accountResourceLockBalance)
      .values({
        accountAddress: to,
        resourceLock: id,
        chainId,
        tokenAddress,
        balance: transferAmount,
        lastUpdatedAt: event.block.timestamp,
        withdrawalStatus: 0,
        withdrawableAt: 0n,
      })
      .onConflictDoUpdate((row) => ({
        balance: row.balance + transferAmount,
        lastUpdatedAt: event.block.timestamp,
      }));

    // Insert delta
    await context.db.insert(schema.accountDelta).values({
      id: `${event.id}-to`,
      address: to,
      counterparty: from,
      tokenAddress,
      resourceLock: id,
      chainId,
      delta: transferAmount,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
    });
  }
});

ponder.on(
  "TheCompact:ForcedWithdrawalStatusUpdated",
  async ({ event, context }) => {
    const {
      account: accountAddress,
      id,
      activating,
      withdrawableAt,
    } = event.args;
    const chainId = BigInt(context.chain.id);
    const timestamp = BigInt(event.block.timestamp);

    // Extract token address from the last 160 bits of the ID
    const tokenAddress = `0x${id
      .toString(16)
      .padStart(64, "0")
      .slice(-40)}` as const;

    // Extract reset period and scope from id
    const resetPeriodIndex = Number((id >> 252n) & 0x7n);
    const scope = Number((id >> 255n) & 0x1n);
    const resetPeriod = Object.values(ResetPeriod)[resetPeriodIndex]!;
    const isMultichain = scope === Scope.Multichain;

    const allocatorId = (id >> 160n) & ((1n << 92n) - 1n);

    const allocatorMapping = await context.db.find(schema.allocatorLookup, {
      allocatorId,
      chainId,
    });

    const allocatorAddress = allocatorMapping!.allocatorAddress;

    const existingToken = await insertTokenIfNotExists({
      address: tokenAddress,
      chainId,
      timestamp: event.block.timestamp,
      context,
    });

    const existingLock = await context.db.find(schema.resourceLock, {
      lockId: id,
      chainId,
    });

    if (!existingLock) {
      await context.db.insert(schema.resourceLock).values({
        lockId: id,
        chainId,
        tokenAddress,
        allocatorAddress,
        resetPeriod: BigInt(resetPeriod),
        isMultichain: isMultichain,
        mintedAt: event.block.timestamp,
        totalSupply: 0n,
        name: `Compact ${existingToken.name}`,
        symbol: `🤝-${existingToken.symbol}`,
        decimals: existingToken.decimals,
      });
    }

    // Get the balance record
    const existingBalance = await context.db.find(
      schema.accountResourceLockBalance,
      {
        accountAddress,
        resourceLock: id,
        chainId,
      },
    );

    if (!existingBalance) {
      await context.db.insert(schema.accountResourceLockBalance).values({
        accountAddress,
        resourceLock: id,
        chainId,
        tokenAddress,
        balance: 0n,
        lastUpdatedAt: event.block.timestamp,
        withdrawalStatus: 0,
        withdrawableAt: 0n,
      });
    }

    // Determine status based on withdrawableAt
    const withdrawableAtBigInt = BigInt(withdrawableAt);
    const status = activating ? 1 : 0;

    await context.db
      .update(schema.accountResourceLockBalance, {
        accountAddress,
        resourceLock: id,
        chainId,
      })
      .set({
        withdrawalStatus: status,
        withdrawableAt: withdrawableAtBigInt,
        lastUpdatedAt: timestamp,
      });
  },
);

ponder.on("TheCompact:Claim", async ({ event, context }) => {
  const { sponsor, allocator, arbiter, claimHash } = event.args;
  const chainId = BigInt(context.chain.id);

  // Ensure sponsor account exists
  await context.db
    .insert(schema.account)
    .values({
      address: sponsor,
    })
    .onConflictDoNothing();

  // Ensure allocator exists
  await context.db
    .insert(schema.account)
    .values({
      address: allocator,
    })
    .onConflictDoNothing();

  // Create claim record

  // NOTE: Do we need allocatorId?
  await context.db.insert(schema.claim).values({
    claimHash,
    chainId,
    sponsor,
    allocator,
    arbiter,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
  });
});

ponder.on("TheCompact:CompactRegistered", async ({ event, context }) => {
  const { sponsor, claimHash, typehash, expires } = event.args;
  const chainId = BigInt(context.chain.id);

  // Ensure sponsor account exists
  await context.db
    .insert(schema.account)
    .values({
      address: sponsor,
    })
    .onConflictDoNothing();

  // Create registered compact record
  await context.db.insert(schema.registeredCompact).values({
    claimHash,
    chainId,
    sponsor,
    timestamp: event.block.timestamp,
    blockNumber: event.block.number,
    expires: BigInt(expires),
    typehash,
  });
});

// Other events that we'll implement later
ponder.on("TheCompact:Approval", async ({ event, context }) => {
  console.log(`Approval event on ${context.chain.name}:`, event);
});

ponder.on("TheCompact:OperatorSet", async ({ event, context }) => {
  console.log(`OperatorSet event on ${context.chain.name}:`, event);
});
