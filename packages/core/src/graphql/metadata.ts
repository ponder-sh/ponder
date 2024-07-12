import { GraphQLObjectType } from "graphql";
import { GraphQLJSON } from "./graphQLJson.js";

export const metadataEntity = new GraphQLObjectType({
  name: "_metadata",
  fields: { status: { type: GraphQLJSON } },
});
