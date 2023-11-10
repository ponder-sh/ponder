import type { GraphQLObjectType } from "graphql";
import {
  type GraphQLFieldConfig,
  type GraphQLFieldResolver,
  GraphQLInt,
  GraphQLNonNull,
} from "graphql";

import type { BaseColumn, ID, Schema } from "@/schema/types.js";

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
  entityGqlType,
}: {
  tableName: string;
  table: Schema["tables"][string];
  entityGqlType: GraphQLObjectType<Source, Context>;
}): GraphQLFieldConfig<Source, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { store } = context;
    const { id, timestamp } = args;

    if (id === undefined) return null;

    const entityInstance = await store.findUnique({
      modelName: tableName,
      id,
      timestamp,
    });

    return entityInstance;
  };

  return {
    type: entityGqlType,
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
