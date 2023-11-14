import { p } from "@ponder/core";

export default p.createSchema({
  LiquidationEvent: p.createTable({
    id: p.string(),
    liquidator: p.string(),
  }),
  OwnershipTransferredEvent: p.createTable({
    id: p.string(),
    newOwner: p.string(),
  }),
});
