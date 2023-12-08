import { createSchema } from "@ponder/core";

export default createSchema((p) => ({
  LiquidationEvent: p.createTable({
    id: p.bytes(),
    liquidator: p.bytes(),
  }),
  OwnershipTransferredEvent: p.createTable({
    id: p.bytes(),
    newOwner: p.bytes(),
  }),
}));
