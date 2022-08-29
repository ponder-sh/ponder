import {
  GraphQLFieldConfig,
  GraphQLFieldResolver,
  GraphQLID,
  GraphQLNonNull,
  GraphQLObjectType,
} from "graphql";

import type { Context, Source } from "./types";

type SingularArgs = {
  id?: string;
};
type SingularResolver = GraphQLFieldResolver<Source, Context, SingularArgs>;

const buildSingularField = (
  entityType: GraphQLObjectType
): GraphQLFieldConfig<Source, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { db } = context;
    const { id } = args;
    if (!id) return null;

    const query = db(entityType.name).where({ id: id });
    const records = await query;

    return records[0] || null;
  };

  return {
    type: entityType,
    args: {
      id: { type: new GraphQLNonNull(GraphQLID) },
    },
    resolve: resolver,
  };
};

export { buildSingularField };
