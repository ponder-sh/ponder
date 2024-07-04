import { hasSubfield } from "@/utils/hasSubfield.js";
import {
  type GraphQLFieldConfig,
  type GraphQLFieldResolver,
  type GraphQLInputObjectType,
  GraphQLInt,
  GraphQLNonNull,
  type GraphQLObjectType,
  GraphQLString,
} from "graphql";
import type { Context, Parent } from "./buildGraphqlSchema.js";
import { buildWhereObject } from "./filter.js";

type PluralArgs = {
  where?: { [key: string]: number | string };
  after?: string;
  before?: string;
  limit?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};

export type PluralResolver = GraphQLFieldResolver<Parent, Context, PluralArgs>;

export const buildPluralField = ({
  tableName,
  entityPageType,
  entityFilterType,
}: {
  tableName: string;
  entityPageType: GraphQLObjectType;
  entityFilterType: GraphQLInputObjectType;
}): GraphQLFieldConfig<Parent, Context> => {
  const resolver: PluralResolver = async (_, args, context, info) => {
    const { where, orderBy, orderDirection, before, limit, after } = args;

    const whereObject = where ? buildWhereObject(where) : {};

    const orderByObject = orderBy
      ? { [orderBy]: orderDirection || "asc" }
      : undefined;

    const withTotalCount = hasSubfield(info, ["totalCount"]);

    return await context.store.findMany({
      tableName,
      where: whereObject,
      orderBy: orderByObject,
      limit,
      before,
      after,
      withTotalCount,
    });
  };

  return {
    type: new GraphQLNonNull(entityPageType),
    args: {
      where: { type: entityFilterType },
      orderBy: { type: GraphQLString },
      orderDirection: { type: GraphQLString },
      before: { type: GraphQLString },
      after: { type: GraphQLString },
      limit: { type: GraphQLInt },
    },
    resolve: resolver,
  };
};
