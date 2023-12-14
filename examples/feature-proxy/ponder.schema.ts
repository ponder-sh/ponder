import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  LiquidationEvent: p.createTable({
    id: p.string(),
    liquidator: p.bytes(),
  }),
  OwnershipTransferredEvent: p.createTable({
    id: p.string(),
    newOwner: p.bytes(),
  }),
}));
