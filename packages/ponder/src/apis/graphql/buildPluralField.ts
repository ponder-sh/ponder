import {
  GraphQLBoolean,
  GraphQLFieldConfig,
  GraphQLFieldResolver,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLScalarType,
  GraphQLString,
} from "graphql";

import { Entity, FieldKind } from "@/core/schema/types";

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

type FilterFieldResolverConfig = {
  operator: string;
  isList?: boolean;
  patternPrefix?: string;
  patternSuffix?: string;
};

// const universalSuffixToResolverConfig: {
//   [key: string]: FilterFieldResolverConfig;
// } = {
//   "": { operator: "=" },
//   _not: { operator: "!=" },
// };
// const universalFilterSuffixes = Object.keys(universalSuffixToResolverConfig);

// // This applies to all types other than String and List types.
// const nonCollectionSuffixToResolverConfig: {
//   [key: string]: FilterFieldResolverConfig;
// } = {
//   _in: { operator: "in", isList: true },
//   _not_in: { operator: "not in", isList: true },
// };
// const nonCollectionFilterSuffixes = Object.keys(
//   nonCollectionSuffixToResolverConfig
// );

// // This applies to String and List types.
// const collectionSuffixToResolverConfig: {
//   [key: string]: FilterFieldResolverConfig;
// } = {
//   _contains: { operator: "like", patternPrefix: "%", patternSuffix: "%" },
//   _contains_nocase: {
//     operator: "like",
//     patternPrefix: "%",
//     patternSuffix: "%",
//   },
//   _not_contains: {
//     operator: "not like",
//     patternPrefix: "%",
//     patternSuffix: "%",
//   },
//   _not_contains_nocase: {
//     operator: "not like",
//     patternPrefix: "%",
//     patternSuffix: "%",
//   },
// };
// const collectionFilterSuffixes = Object.keys(collectionSuffixToResolverConfig);

// const numericSuffixToResolverConfig: {
//   [key: string]: FilterFieldResolverConfig;
// } = {
//   _gt: { operator: ">" },
//   _lt: { operator: "<" },
//   _gte: { operator: ">=" },
//   _lte: { operator: "<=" },
// };
// const numericFilterSuffixes = Object.keys(numericSuffixToResolverConfig);

// const stringSuffixToResolverConfig: {
//   [key: string]: FilterFieldResolverConfig;
// } = {
//   _starts_with: { operator: "like", patternSuffix: "%" },
//   _starts_with_nocase: { operator: "like", patternSuffix: "%" },
//   _ends_with: { operator: "like", patternPrefix: "%" },
//   _ends_with_nocase: { operator: "like", patternPrefix: "%" },
//   _not_starts_with: { operator: "not like", patternSuffix: "%" },
//   _not_starts_with_nocase: { operator: "not like", patternSuffix: "%" },
//   _not_ends_with: { operator: "not like", patternSuffix: "%" },
//   _not_ends_with_nocase: { operator: "not like", patternSuffix: "%" },
// };
// const stringFilterSuffixes = Object.keys(stringSuffixToResolverConfig);

const operators = {
  universal: ["", "not"],
  singular: ["in", "not_in"],
  plural: [
    "contains",
    "not_contains",
    "contains_nocase",
    "not_contains_nocase",
  ],
  string: [
    "starts_with",
    "starts_with_nocase",
    "ends_with",
    "ends_with_nocase",
    "not_starts_with",
    "not_starts_with_nocase",
    "not_ends_with",
    "not_ends_with_nocase",
  ],
  numeric: ["gt", "lt", "gte", "lte"],
};

const buildPluralField = (
  entity: Entity
): GraphQLFieldConfig<Source, Context> => {
  const filterFields: Record<string, { type: GraphQLInputType }> = {};

  // This is a helper map constructed during setup that is used by the resolver.
  const filterFieldNameToResolverConfig: Record<
    string,
    {
      fieldName: string;
      resolverConfig: FilterFieldResolverConfig;
    }
  > = {};

  // For each field on the entity, create a bunch of filter fields.
  entity.fields
    // For now, don't create filter fields for relationship types.
    .filter((field) => field.kind !== FieldKind.RELATIONSHIP)
    .forEach((field) => {
      operators.universal.forEach((suffix) => {
        // Small hack to get the correct filter field name.
        let filterFieldName: string;
        if (suffix === "") {
          filterFieldName = `${field.name}`;
        } else {
          filterFieldName = `${field.name}_${suffix}`;
        }
        filterFields[filterFieldName] = { type: field.baseGqlType };
      });

      if (field.kind !== FieldKind.LIST) {
        operators.singular.forEach((suffix) => {
          const filterFieldName = `${field.name}_${suffix}`;

          filterFields[filterFieldName] = {
            type: new GraphQLList(field.baseGqlType),
          };
        });
      }

      if (field.kind === FieldKind.LIST) {
        operators.plural.forEach((suffix) => {
          const filterFieldName = `${field.name}_${suffix}`;
          filterFields[filterFieldName] = { type: field.baseGqlType };
        });
      }

      if (
        field.kind === FieldKind.SCALAR &&
        ["ID", "Int", "Float"].includes(field.baseGqlType.name)
      ) {
        operators.numeric.forEach((suffix) => {
          const filterFieldName = `${field.name}_${suffix}`;
          filterFields[filterFieldName] = { type: field.baseGqlType };
        });
      }

      if (
        field.kind === FieldKind.SCALAR &&
        ["String"].includes(field.baseGqlType.name)
      ) {
        operators.string.forEach((suffix) => {
          const filterFieldName = `${field.name}_${suffix}`;
          filterFields[filterFieldName] = { type: field.baseGqlType };
        });
      }
    });

  console.log({ filterFields });

  const filterType = new GraphQLInputObjectType({
    name: `${entity.name}Filter`,
    fields: filterFields,
  });

  const resolver: PluralResolver = async (_, args, context) => {
    const { store } = context;
    const { where, first, skip, orderBy, orderDirection } = args;

    const fragments: string[] = [];

    if (where) {
      console.log({ where });

      const whereFragments: string[] = [];

      for (const [field, value] of Object.entries(where)) {
        const { fieldName, resolverConfig } =
          filterFieldNameToResolverConfig[field];
        const { operator, patternPrefix, patternSuffix } = resolverConfig;

        let finalValue = value;

        if (patternPrefix) finalValue = patternPrefix + finalValue;
        if (patternSuffix) finalValue = finalValue + patternSuffix;

        whereFragments.push(`\`${fieldName}\` ${operator} '${finalValue}'`);
      }

      fragments.push(`where ${whereFragments.join(" and ")}`);
    }
    if (first) {
      fragments.push(`limit ${first}`);
    }
    if (skip) {
      if (!first) {
        fragments.push(`limit -1`); // Must add a no-op limit for SQLite to handle offset
      }
      fragments.push(`offset ${skip}`);
    }
    if (orderBy) {
      fragments.push(`order by \`${orderBy}\``);
    }
    if (orderDirection) {
      fragments.push(`${orderDirection}`);
    }

    const statement = `select * from \`${entity.name}\` ${fragments.join(" ")}`;

    const entities = store.db.prepare(statement).all();

    return entities;
  };

  return {
    type: new GraphQLNonNull(
      new GraphQLList(new GraphQLNonNull(entity.gqlType))
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
