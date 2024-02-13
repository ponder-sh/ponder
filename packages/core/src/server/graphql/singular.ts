import type { Schema } from "@/schema/types.js";
import { maxCheckpoint } from "@/utils/checkpoint.js";
import type { GraphQLObjectType } from "graphql";
import {
  type GraphQLFieldConfig,
  type GraphQLFieldResolver,
  GraphQLInt,
  GraphQLNonNull,
} from "graphql";
import type { Context, Parent } from "./schema.js";
import { tsTypeToGqlScalar } from "./schema.js";

type SingularArgs = {
  id?: string;
  timestamp?: number;
};
type SingularResolver = GraphQLFieldResolver<Parent, Context, SingularArgs>;

const buildSingularField = ({
  tableName,
  table,
  entityType,
}: {
  tableName: string;
  table: Schema["tables"][string];
  entityType: GraphQLObjectType<Parent, Context>;
}): GraphQLFieldConfig<Parent, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { store } = context;
    const { id, timestamp } = args;

    if (id === undefined) return null;

    const checkpoint = timestamp
      ? { ...maxCheckpoint, blockTimestamp: timestamp }
      : undefined; // Latest.

    const entityInstance = await store.findUnique({
      tableName,
      id,
      checkpoint,
    });

    return entityInstance;
  };

  return {
    type: entityType,
    args: {
      id: { type: new GraphQLNonNull(tsTypeToGqlScalar[table.id.type]) },
      timestamp: { type: GraphQLInt },
    },
    resolve: resolver,
  };
};

export { buildSingularField };
