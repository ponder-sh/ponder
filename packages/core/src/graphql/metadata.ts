import { GraphQLObjectType } from "graphql";
import { GraphQLJSON } from "./graphQLJson.js";

export const metadataEntity = new GraphQLObjectType({
  name: "_meta",
  fields: { status: { type: GraphQLJSON } },
});
