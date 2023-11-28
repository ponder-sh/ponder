import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  LiquidationEvent: p.createTable({
    id: p.string(),
    liquidator: p.string(),
  }),
  OwnershipTransferredEvent: p.createTable({
    id: p.string(),
    newOwner: p.string(),
  }),
}));
