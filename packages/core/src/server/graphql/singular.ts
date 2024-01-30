import type { GraphQLObjectType } from "graphql";
import {
  type GraphQLFieldConfig,
  type GraphQLFieldResolver,
  GraphQLInt,
  GraphQLNonNull,
} from "graphql";

import type { BaseColumn, ID, Schema } from "@/schema/types.js";
import { maxCheckpoint } from "@/utils/checkpoint.js";

import type { Context, Source } from "./schema.js";
import { tsTypeToGqlScalar } from "./schema.js";

type SingularArgs = {
  id?: string;
  timestamp?: number;
};
type SingularResolver = GraphQLFieldResolver<Source, Context, SingularArgs>;

const buildSingularField = ({
  tableName,
  table,
  entityType,
}: {
  tableName: string;
  table: Schema["tables"][string];
  entityType: GraphQLObjectType<Source, Context>;
}): GraphQLFieldConfig<Source, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { store } = context;
    const { id, timestamp } = args;

    if (id === undefined) return null;

    const checkpoint = timestamp
      ? { ...maxCheckpoint, blockTimestamp: timestamp }
      : undefined; // Latest.

    const entityInstance = await store.findUnique({
      tableName: tableName,
      id,
      checkpoint,
    });

    return entityInstance;
  };

  return {
    type: entityType,
    args: {
      id: {
        type: new GraphQLNonNull(
          tsTypeToGqlScalar[
            (table as { id: BaseColumn<ID, never, false, false> }).id.type
          ],
        ),
      },
      timestamp: { type: GraphQLInt },
    },
    resolve: resolver,
  };
};

export { buildSingularField };
