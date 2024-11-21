import { ponder } from "@/generated";
import { graphql } from "ponder";

ponder.use("/graphql", graphql());
ponder.use("/", graphql());
