import { ponder } from "ponder:registry";
import { graphql } from "ponder";

ponder.use("/graphql", graphql());
ponder.use("/", graphql());
