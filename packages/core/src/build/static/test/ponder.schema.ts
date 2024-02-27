import { createSchema } from "../../../schema/schema.js";

export default createSchema((p) => ({
  Table1: p.createTable({
    id: p.string(),
  }),
  Table2: p.createTable({
    id: p.string(),
  }),
  Table3: p.createTable({
    id: p.string(),
  }),
}));
