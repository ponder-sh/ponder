import { index, onchainTable, primaryKey, relations } from "ponder";

export const account = onchainTable("account", (t) => ({
  address: t.hex().primaryKey(),
}));

export const allocator = onchainTable("allocator", (t) => ({
  address: t.hex().primaryKey(),
}));

export const allocatorRegistration = onchainTable(
  "allocator_registration",
  (t) => ({
    allocatorAddress: t.hex().notNull(),
    chainId: t.bigint().notNull(),
    registeredAt: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.allocatorAddress, table.chainId] }),
    allocatorAddressIdx: index().on(table.allocatorAddress),
    chainIdIdx: index().on(table.chainId),
  }),
);

export const depositedToken = onchainTable(
  "deposited_token",
  (t) => ({
    chainId: t.bigint().notNull(),
    tokenAddress: t.hex().notNull(),
    firstSeenAt: t.bigint().notNull(),
    totalSupply: t.bigint().notNull(),
    name: t.text().notNull(),
    symbol: t.text().notNull(),
    decimals: t.integer().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.tokenAddress, table.chainId] }),
    tokenAddressIdx: index().on(table.tokenAddress),
    chainIdIdx: index().on(table.chainId),
  }),
);

export const resourceLock = onchainTable(
  "resource_lock",
  (t) => ({
    lockId: t.bigint().notNull(),
    chainId: t.bigint().notNull(),
    tokenAddress: t.hex().notNull(),
    allocatorAddress: t.hex().notNull(),
    resetPeriod: t.bigint().notNull(),
    isMultichain: t.boolean().notNull(),
    mintedAt: t.bigint().notNull(),
    totalSupply: t.bigint().notNull(),
    name: t.text().notNull(),
    symbol: t.text().notNull(),
    decimals: t.integer().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.lockId, table.chainId] }),
    lockIdIdx: index().on(table.lockId),
    chainIdIdx: index().on(table.chainId),
    tokenRegIdx: index().on(table.tokenAddress, table.chainId),
    allocRegIdx: index().on(table.allocatorAddress, table.chainId),
  }),
);

export const accountTokenBalance = onchainTable(
  "account_token_balance",
  (t) => ({
    accountAddress: t.hex().notNull(),
    tokenAddress: t.hex().notNull(),
    chainId: t.bigint().notNull(),
    balance: t.bigint().notNull(),
    lastUpdatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.accountAddress, table.tokenAddress, table.chainId],
    }),
    accountIdx: index().on(table.accountAddress),
    tokenRegIdx: index().on(table.tokenAddress, table.chainId),
  }),
);

export const accountResourceLockBalance = onchainTable(
  "account_resource_lock_balance",
  (t) => ({
    accountAddress: t.hex().notNull(),
    resourceLock: t.bigint().notNull(),
    chainId: t.bigint().notNull(),
    tokenAddress: t.hex().notNull(),
    balance: t.bigint().notNull(),
    withdrawalStatus: t.integer().notNull().default(0),
    withdrawableAt: t.bigint().notNull().default(0n),
    lastUpdatedAt: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.accountAddress, table.resourceLock, table.chainId],
    }),
    accountIdx: index().on(table.accountAddress),
    resourceLockIdx: index().on(table.resourceLock, table.chainId),
    tokenRegIdx: index().on(table.tokenAddress, table.chainId),
  }),
);

export const accountDelta = onchainTable(
  "account_delta",
  (t) => ({
    id: t.text().primaryKey(),
    address: t.hex().notNull(),
    counterparty: t.hex().notNull(),
    tokenAddress: t.hex().notNull(),
    resourceLock: t.bigint().notNull(),
    chainId: t.bigint().notNull(),
    delta: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    blockTimestamp: t.bigint().notNull(),
  }),
  (table) => ({
    tokenRegIdx: index().on(table.tokenAddress, table.chainId),
    resourceLockIdx: index().on(table.resourceLock, table.chainId),
    addressIdx: index().on(table.address),
  }),
);

export const claim = onchainTable(
  "claim",
  (t) => ({
    claimHash: t.hex().notNull(),
    chainId: t.bigint().notNull(),
    sponsor: t.hex().notNull(),
    allocator: t.hex().notNull(),
    arbiter: t.hex().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.claimHash, table.chainId] }),
    claimHashIdx: index().on(table.claimHash),
    chainIdIdx: index().on(table.chainId),
    sponsorIdx: index().on(table.sponsor),
    allocatorIdx: index().on(table.allocator),
    allocatorChainIdx: index().on(table.allocator, table.chainId),
  }),
);

export const registeredCompact = onchainTable(
  "registered_compact",
  (t) => ({
    claimHash: t.hex(), // Nullable but part of PK
    chainId: t.bigint().notNull(),
    sponsor: t.hex().notNull(),
    timestamp: t.bigint().notNull(),
    blockNumber: t.bigint().notNull(),
    expires: t.bigint().notNull(),
    typehash: t.hex().notNull(), // Added typehash field from CompactRegistered event
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.claimHash, table.chainId] }),
    chainIdIdx: index().on(table.chainId),
    sponsorIdx: index().on(table.sponsor),
  }),
);

export const allocatorLookup = onchainTable(
  "allocatorLookup",
  (t) => ({
    allocatorId: t.bigint().notNull(),
    chainId: t.bigint().notNull(),
    allocatorAddress: t.hex().notNull(),
  }),
  (table) => ({
    pk: primaryKey({ columns: [table.allocatorId, table.chainId] }),
    chainIdIdx: index().on(table.chainId),
    allocatorAddressIdx: index().on(table.allocatorAddress),
  }),
);

export const allocatorChainId = onchainTable(
  "allocatorChainId",
  (t) => ({
    allocatorAddress: t.hex().notNull(),
    allocatorId: t.bigint().notNull(),
    chainId: t.bigint().notNull(),
    firstSeenAt: t.bigint().notNull(),
  }),
  (table) => ({
    pk: primaryKey({
      columns: [table.allocatorAddress, table.allocatorId, table.chainId],
    }),
    allocatorAddressIdx: index().on(table.allocatorAddress),
    chainIdIdx: index().on(table.chainId),
  }),
);

export const accountRelations = relations(account, ({ many }) => ({
  claims: many(claim),
  registeredCompacts: many(registeredCompact),
  tokenBalances: many(accountTokenBalance),
  resourceLocks: many(accountResourceLockBalance),
}));

export const allocatorRelations = relations(allocator, ({ many }) => ({
  supportedChains: many(allocatorChainId),
  registrations: many(allocatorRegistration),
  claims: many(claim),
}));

export const allocatorChainIdRelations = relations(
  allocatorChainId,
  ({ one }) => ({
    parent: one(allocator, {
      fields: [allocatorChainId.allocatorAddress],
      references: [allocator.address],
    }),
  }),
);

export const claimRelations = relations(claim, ({ one }) => ({
  sponsor: one(account, {
    fields: [claim.sponsor],
    references: [account.address],
  }),
  allocator: one(allocator, {
    fields: [claim.allocator],
    references: [allocator.address],
  }),
  allocatorChainId: one(allocatorChainId, {
    fields: [claim.allocator, claim.chainId],
    references: [allocatorChainId.allocatorAddress, allocatorChainId.chainId],
  }),
}));

export const allocatorRegistrationRelations = relations(
  allocatorRegistration,
  ({ one }) => ({
    allocator: one(allocator, {
      fields: [allocatorRegistration.allocatorAddress],
      references: [allocator.address],
    }),
  }),
);

export const depositedTokenRelations = relations(
  depositedToken,
  ({ many }) => ({
    accountBalances: many(accountTokenBalance),
    resourceLocks: many(resourceLock),
  }),
);

export const resourceLockRelations = relations(
  resourceLock,
  ({ one, many }) => ({
    token: one(depositedToken, {
      fields: [resourceLock.tokenAddress, resourceLock.chainId],
      references: [depositedToken.tokenAddress, depositedToken.chainId],
    }),
    allocator: one(allocatorRegistration, {
      fields: [resourceLock.allocatorAddress, resourceLock.chainId],
      references: [
        allocatorRegistration.allocatorAddress,
        allocatorRegistration.chainId,
      ],
    }),
    accountBalances: many(accountResourceLockBalance),
  }),
);

export const accountTokenBalanceRelations = relations(
  accountTokenBalance,
  ({ one, many }) => ({
    account: one(account, {
      fields: [accountTokenBalance.accountAddress],
      references: [account.address],
    }),
    token: one(depositedToken, {
      fields: [accountTokenBalance.tokenAddress, accountTokenBalance.chainId],
      references: [depositedToken.tokenAddress, depositedToken.chainId],
    }),
    resourceLocks: many(accountResourceLockBalance),
  }),
);

export const accountResourceLockBalanceRelations = relations(
  accountResourceLockBalance,
  ({ one }) => ({
    account: one(account, {
      fields: [accountResourceLockBalance.accountAddress],
      references: [account.address],
    }),
    resourceLock: one(resourceLock, {
      fields: [
        accountResourceLockBalance.resourceLock,
        accountResourceLockBalance.chainId,
      ],
      references: [resourceLock.lockId, resourceLock.chainId],
    }),
    tokenBalance: one(accountTokenBalance, {
      fields: [
        accountResourceLockBalance.accountAddress,
        accountResourceLockBalance.tokenAddress,
        accountResourceLockBalance.chainId,
      ],
      references: [
        accountTokenBalance.accountAddress,
        accountTokenBalance.tokenAddress,
        accountTokenBalance.chainId,
      ],
    }),
  }),
);

export const registeredCompactRelations = relations(
  registeredCompact,
  ({ one }) => ({
    sponsor: one(account, {
      fields: [registeredCompact.sponsor],
      references: [account.address],
    }),
    claim: one(claim, {
      fields: [registeredCompact.claimHash, registeredCompact.chainId],
      references: [claim.claimHash, claim.chainId],
    }),
  }),
);

export const accountDeltaRelations = relations(accountDelta, ({ one }) => ({
  token: one(depositedToken, {
    fields: [accountDelta.tokenAddress, accountDelta.chainId],
    references: [depositedToken.tokenAddress, depositedToken.chainId],
  }),
  lock: one(resourceLock, {
    fields: [accountDelta.resourceLock, accountDelta.chainId],
    references: [resourceLock.lockId, resourceLock.chainId],
  }),
  account: one(account, {
    fields: [accountDelta.address],
    references: [account.address],
  }),
}));
