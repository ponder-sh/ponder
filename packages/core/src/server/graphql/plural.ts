import {
  GraphQLFieldConfig,
  GraphQLFieldResolver,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";

import type { Entity } from "@/schema/types";

import type { Context, Source } from "./schema";

type WhereInputArg = {
  [key: string]: number | string;
};
type PluralArgs = {
  where?: WhereInputArg;
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  timestamp?: number;
};
type PluralResolver = GraphQLFieldResolver<Source, Context, PluralArgs>;

const operators = {
  universal: ["", "_not"],
  singular: ["_in", "_not_in"],
  plural: ["_contains", "_not_contains"],
  numeric: ["_gt", "_lt", "_gte", "_lte"],
  string: [
    "_contains",
    "_not_contains",
    "_starts_with",
    "_ends_with",
    "_not_starts_with",
    "_not_ends_with",
  ],
};

const buildPluralField = ({
  entity,
  entityGqlType,
}: {
  entity: Entity;
  entityGqlType: GraphQLObjectType<Source, Context>;
}): GraphQLFieldConfig<Source, Context> => {
  const filterFields: Record<string, { type: GraphQLInputType }> = {};

  entity.fields.forEach((field) => {
    switch (field.kind) {
      case "SCALAR": {
        // Scalar fields => universal, singular, numeric OR string depending on base type
        // Note: Booleans => universal and singular only.
        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: field.scalarGqlType,
          };
        });

        operators.singular.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.scalarGqlType),
          };
        });

        if (["Int", "BigInt", "Float"].includes(field.scalarTypeName)) {
          operators.numeric.forEach((suffix) => {
            filterFields[`${field.name}${suffix}`] = {
              type: field.scalarGqlType,
            };
          });
        }

        if (["String", "Bytes"].includes(field.scalarTypeName)) {
          operators.string.forEach((suffix) => {
            filterFields[`${field.name}${suffix}`] = {
              type: field.scalarGqlType,
            };
          });
        }

        break;
      }
      case "ENUM": {
        // Enum fields => universal, singular
        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = { type: field.enumGqlType };
        });

        operators.singular.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.enumGqlType),
          };
        });
        break;
      }
      case "LIST": {
        // List fields => universal, plural
        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.baseGqlType),
          };
        });

        operators.plural.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = { type: field.baseGqlType };
        });
        break;
      }
      case "RELATIONSHIP": {
        // Relationship fields => universal, singular, numeric OR string depending on base type
        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: field.relatedEntityIdType,
          };
        });

        operators.singular.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.relatedEntityIdType),
          };
        });

        if (
          ["Int", "BigInt", "Float"].includes(field.relatedEntityIdType.name)
        ) {
          operators.numeric.forEach((suffix) => {
            filterFields[`${field.name}${suffix}`] = {
              type: field.relatedEntityIdType,
            };
          });
        }

        if (["String", "Bytes"].includes(field.relatedEntityIdType.name)) {
          operators.string.forEach((suffix) => {
            filterFields[`${field.name}${suffix}`] = {
              type: field.relatedEntityIdType,
            };
          });
        }

        // TODO: Add complex "{fieldName}_" filter field.
        break;
      }
      case "DERIVED": {
        // TODO: Add derived filter fields.
        break;
      }
    }
  });

  const filterType = new GraphQLInputObjectType({
    name: `${entity.name}Filter`,
    fields: filterFields,
  });

  const resolver: PluralResolver = async (_, args, context) => {
    const { store } = context;

    const filter = args;

    return await store.findMany({
      modelName: entity.name,
      filter: {
        skip: filter.skip,
        first: filter.first,
        orderBy: filter.orderBy,
        orderDirection: filter.orderDirection,
        where: filter.where,
      },
      timestamp: filter.timestamp ? filter.timestamp : undefined,
    });
  };

  return {
    type: new GraphQLNonNull(
      new GraphQLList(new GraphQLNonNull(entityGqlType))
    ),
    args: {
      skip: { type: GraphQLInt, defaultValue: 0 },
      first: { type: GraphQLInt, defaultValue: 100 },
      orderBy: { type: GraphQLString, defaultValue: "id" },
      orderDirection: { type: GraphQLString, defaultValue: "asc" },
      where: { type: filterType },
      timestamp: { type: GraphQLInt },
    },
    resolve: resolver,
  };
};

export { buildPluralField };
