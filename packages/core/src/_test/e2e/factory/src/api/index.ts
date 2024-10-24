// @ts-ignore
import { ponder } from "@/generated";
// import { graphql } from "@/index.js";

// biome-ignore lint/suspicious/noRedeclare: :)
declare const ponder: import("@/index.js").Virtual.Registry<
  typeof import("../../ponder.config.js").default,
  typeof import("../../ponder.schema.js")
>;

// ponder.use("/graphql", graphql());
