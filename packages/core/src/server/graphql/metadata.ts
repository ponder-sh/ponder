import { GraphQLObjectType } from "graphql";
import { GraphQLJSON } from "graphql-type-json";

export const metadataEntity = new GraphQLObjectType({
  name: "_meta",
  fields: { status: { type: GraphQLJSON } },
});
