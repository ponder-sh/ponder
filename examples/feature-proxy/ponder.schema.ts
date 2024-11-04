import { onchainTable } from "@ponder/core";

export const liquidationEvent = onchainTable("liquidation_event", (p) => ({
  id: p.text().primaryKey(),
  liquidator: p.hex().notNull(),
}));

export const ownershipTransferEvent = onchainTable(
  "ownership_transfer_event",
  (p) => ({
    id: p.text().primaryKey(),
    newOwner: p.hex().notNull(),
  }),
);
