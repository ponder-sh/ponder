import { ponder } from "ponder:registry";
import { graphql } from "@/index.js";

ponder.use("/graphql", graphql());
