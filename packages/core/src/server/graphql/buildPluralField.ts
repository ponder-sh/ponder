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

import type { Context, Source } from "./buildGqlSchema";

type WhereInputArg = {
  [key: string]: number | string;
};
type PluralArgs = {
  where?: WhereInputArg;
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
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

  const deserializers: Record<string, (value: any) => any | undefined> = {};

  entity.fields.forEach((field) => {
    switch (field.kind) {
      case "SCALAR": {
        // Scalar fields => universal, singular, numeric OR string depending on base type
        // Note: Booleans => universal and singular only.
        const isBigInt = field.scalarTypeName === "BigInt";

        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: field.scalarGqlType,
          };
          if (isBigInt) deserializers[`${field.name}${suffix}`] = BigInt;
        });

        operators.singular.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.scalarGqlType),
          };
          if (isBigInt)
            deserializers[`${field.name}${suffix}`] = (values: string[]) =>
              values.map(BigInt);
        });

        if (["Int", "BigInt", "Float"].includes(field.scalarTypeName)) {
          operators.numeric.forEach((suffix) => {
            filterFields[`${field.name}${suffix}`] = {
              type: field.scalarGqlType,
            };
            if (isBigInt) deserializers[`${field.name}${suffix}`] = BigInt;
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
        const isBigIntList = field.baseGqlType.name === "BigInt";

        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.baseGqlType),
          };
          if (isBigIntList)
            deserializers[`${field.name}${suffix}`] = (values: string[]) =>
              values.map(BigInt);
        });

        operators.plural.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = { type: field.baseGqlType };
          if (isBigIntList) deserializers[`${field.name}${suffix}`] = BigInt;
        });
        break;
      }
      case "RELATIONSHIP": {
        // Relationship fields => universal, singular, numeric OR string depending on base type
        const isBigInt = field.relatedEntityIdType.name === "BigInt";

        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: field.relatedEntityIdType,
          };
          if (isBigInt) deserializers[`${field.name}${suffix}`] = BigInt;
        });

        operators.singular.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.relatedEntityIdType),
          };
          if (isBigInt)
            deserializers[`${field.name}${suffix}`] = (values: string[]) =>
              values.map(BigInt);
        });

        if (
          ["Int", "BigInt", "Float"].includes(field.relatedEntityIdType.name)
        ) {
          operators.numeric.forEach((suffix) => {
            filterFields[`${field.name}${suffix}`] = {
              type: field.relatedEntityIdType,
            };
            if (isBigInt) deserializers[`${field.name}${suffix}`] = BigInt;
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

    // Any args for BigInt fields present in the where object will be serialized as
    // strings. They need to be converted to bigints before passing to the store.
    if (filter.where) {
      for (const key in filter.where) {
        filter.where[key] = deserializers[key]
          ? deserializers[key](filter.where[key])
          : filter.where[key];
      }
    }

    return await store.findMany({ modelName: entity.name, filter });
  };

  return {
    type: new GraphQLNonNull(
      new GraphQLList(new GraphQLNonNull(entityGqlType))
    ),
    args: {
      where: { type: filterType },
      first: { type: GraphQLInt },
      skip: { type: GraphQLInt },
      orderBy: { type: GraphQLString },
      orderDirection: { type: GraphQLString },
    },
    resolve: resolver,
  };
};

export { buildPluralField };
