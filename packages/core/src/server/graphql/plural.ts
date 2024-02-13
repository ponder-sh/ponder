import { maxCheckpoint } from "@/utils/checkpoint.js";
import {
  type GraphQLFieldConfig,
  type GraphQLFieldResolver,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";
import { buildWhereObject } from "./filter.js";
import { type Context, type Parent } from "./schema.js";

type PluralArgs = {
  where?: { [key: string]: number | string };
  after?: string;
  before?: string;
  limit?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  timestamp?: number;
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
  const resolver: PluralResolver = async (_, args, context) => {
    const { store } = context;

    const { timestamp, where, orderBy, orderDirection, before, limit, after } =
      args;

    const checkpoint = timestamp
      ? { ...maxCheckpoint, blockTimestamp: timestamp }
      : undefined; // Latest.

    const whereObject = where ? buildWhereObject({ where }) : {};

    const orderByObject = orderBy
      ? { [orderBy]: orderDirection || "asc" }
      : undefined;

    return await store.findMany({
      tableName,
      checkpoint,
      where: whereObject,
      orderBy: orderByObject,
      limit,
      before,
      after,
    });
  };

  return {
    type: entityPageType,
    args: {
      timestamp: { type: GraphQLInt },
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
