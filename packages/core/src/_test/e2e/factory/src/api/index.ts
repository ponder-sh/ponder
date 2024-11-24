import { ponder } from "@/generated";
import { graphql } from "@/index.js";

ponder.use("/graphql", graphql());
