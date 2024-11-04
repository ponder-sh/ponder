import { onchainTable } from "@ponder/core";

export const liquidationEvent = onchainTable("liquidation_event", (t) => ({
  id: t.text().primaryKey(),
  liquidator: t.hex().notNull(),
}));

export const ownershipTransferEvent = onchainTable(
  "ownership_transfer_event",
  (t) => ({
    id: t.text().primaryKey(),
    newOwner: t.hex().notNull(),
  }),
);
