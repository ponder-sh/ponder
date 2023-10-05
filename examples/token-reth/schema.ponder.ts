const { createSchema, createTable } = require("@ponder/core");

exports.schema = createSchema([
  createTable("Transfer")
    .addColumn("id", "string")
    .addColumn("sender", "string"),
]);

// type Transfer @entity {
//   id: String!
//   sender: String!
//   receiver: String!
//   amount: BigInt!
//   timestamp: BigInt!
//   txHash: String!
//   blockNumber: BigInt!
//   logIndex: Int!
// }

// type Approval @entity {
//   id: String!
//   owner: String!
//   spender: String!
//   value: BigInt!
//   timestamp: BigInt!
//   txHash: String!
//   blockNumber: BigInt!
//   logIndex: Int!
// }
