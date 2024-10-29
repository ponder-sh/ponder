import { onchainTable } from "@ponder/core";

export const liquidationEvent = onchainTable("liquidation_event", (p) => ({
  id: p.serial().primaryKey(),
  liquidator: p.hex().notNull(),
}));

export const ownershipTransferEvent = onchainTable(
  "ownership_transfer_event",
  (p) => ({
    id: p.serial().primaryKey(),
    newOwner: p.hex().notNull(),
  }),
);
