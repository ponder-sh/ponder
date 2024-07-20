import type { Table } from "@/schema/common.js";
import type { GraphQLObjectType } from "graphql";
import {
  type GraphQLFieldConfig,
  type GraphQLFieldResolver,
  GraphQLNonNull,
} from "graphql";
import type { Context, Parent } from "./buildGraphqlSchema.js";
import { SCALARS } from "./scalar.js";

type SingularArgs = {
  id?: string;
};
type SingularResolver = GraphQLFieldResolver<Parent, Context, SingularArgs>;

export const buildSingularField = ({
  tableName,
  table,
  entityType,
}: {
  tableName: string;
  table: Table;
  entityType: GraphQLObjectType<Parent, Context>;
}): GraphQLFieldConfig<Parent, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { id } = args;

    if (id === undefined) return null;

    const entityInstance = await context.readonlyStore.findUnique({
      tableName,
      id,
    });

    return entityInstance;
  };

  return {
    type: entityType,
    args: {
      id: { type: new GraphQLNonNull(SCALARS[table.id[" scalar"]]) },
    },
    resolve: resolver,
  };
};
