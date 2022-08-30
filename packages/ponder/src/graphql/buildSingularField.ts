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

    // TODO: use helper function to prepare this query
    const entity = db
      .prepare(`select * from \`${entityType.name}\` where id = '@id'`)
      .get({ id: id });
    console.log("got entity in resolver:", { entity });

    if (!entity) {
      return null;
    }

    // TODO: build entity object that works for field resolution.
    const resolvedEntity = entity;

    return resolvedEntity;
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
