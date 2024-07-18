import { ponder } from "@/generated";
import { graphql } from "@ponder/core";

ponder.use("/graphql", graphql());
ponder.use("/", graphql());
