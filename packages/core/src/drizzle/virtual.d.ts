declare module "ponder:db" {
  type RuntimeConfig = typeof import("./virtual.js");

  export const sql: RuntimeConfig["sql"];

  export const eq: RuntimeConfig["eq"];
  export const gt: RuntimeConfig["gt"];
  export const gte: RuntimeConfig["gte"];
  export const lt: RuntimeConfig["lt"];
  export const lte: RuntimeConfig["lte"];
  export const ne: RuntimeConfig["ne"];
  export const isNull: RuntimeConfig["isNull"];
  export const isNotNull: RuntimeConfig["isNotNull"];
  export const inArray: RuntimeConfig["inArray"];
  export const notInArray: RuntimeConfig["notInArray"];
  export const exists: RuntimeConfig["exists"];
  export const notExists: RuntimeConfig["notExists"];
  export const between: RuntimeConfig["between"];
  export const notBetween: RuntimeConfig["notBetween"];
  export const like: RuntimeConfig["like"];
  export const notIlike: RuntimeConfig["notIlike"];
  export const not: RuntimeConfig["not"];
  export const asc: RuntimeConfig["asc"];
  export const desc: RuntimeConfig["desc"];
  export const and: RuntimeConfig["and"];
  export const or: RuntimeConfig["or"];
  export const count: RuntimeConfig["count"];
  export const countDistinct: RuntimeConfig["countDistinct"];
  export const avg: RuntimeConfig["avg"];
  export const avgDistinct: RuntimeConfig["avgDistinct"];
  export const sum: RuntimeConfig["sum"];
  export const sumDistinct: RuntimeConfig["sumDistinct"];
  export const max: RuntimeConfig["max"];
  export const min: RuntimeConfig["min"];
}
