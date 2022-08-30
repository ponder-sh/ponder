import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLFieldConfig,
  GraphQLFieldResolver,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLString,
  Kind,
} from "graphql";

import type { Context, Source } from "./types";

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

const gqlScalarStringToType: { [key: string]: GraphQLScalarType | undefined } =
  {
    ID: GraphQLID,
    Int: GraphQLInt,
    Float: GraphQLFloat,
    String: GraphQLString,
    Boolean: GraphQLBoolean,
  };

type FilterFieldResolverConfig = {
  operator: string;
  isList?: boolean;
  patternPrefix?: string;
  patternSuffix?: string;
};

const universalSuffixToResolverConfig: {
  [key: string]: FilterFieldResolverConfig;
} = {
  "": { operator: "=" },
  _not: { operator: "!=" },
  _in: { operator: "in", isList: true },
  _not_in: { operator: "not in", isList: true },
};
const universalFilterSuffixes = Object.keys(universalSuffixToResolverConfig);

const numericSuffixToResolverConfig: {
  [key: string]: FilterFieldResolverConfig;
} = {
  _gt: { operator: ">" },
  _lt: { operator: "<" },
  _gte: { operator: ">=" },
  _lte: { operator: "<=" },
};
const numericFilterSuffixes = Object.keys(numericSuffixToResolverConfig);

const stringSuffixToResolverConfig: {
  [key: string]: FilterFieldResolverConfig;
} = {
  _contains: { operator: "like", patternPrefix: "%", patternSuffix: "%" },
  _contains_nocase: {
    operator: "like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  _not_contains: {
    operator: "not like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  _not_contains_nocase: {
    operator: "not like",
    patternPrefix: "%",
    patternSuffix: "%",
  },
  _starts_with: { operator: "like", patternSuffix: "%" },
  _starts_with_nocase: { operator: "like", patternSuffix: "%" },
  _ends_with: { operator: "like", patternPrefix: "%" },
  _ends_with_nocase: { operator: "like", patternPrefix: "%" },
  _not_starts_with: { operator: "not like", patternSuffix: "%" },
  _not_starts_with_nocase: { operator: "not like", patternSuffix: "%" },
  _not_ends_with: { operator: "not like", patternSuffix: "%" },
  _not_ends_with_nocase: { operator: "not like", patternSuffix: "%" },
};
const stringFilterSuffixes = Object.keys(stringSuffixToResolverConfig);

const buildPluralField = (
  entityType: GraphQLObjectType,
  userDefinedTypes: {
    [key: string]: GraphQLObjectType | GraphQLEnumType | undefined;
  }
): GraphQLFieldConfig<Source, Context> => {
  const entityFields = (entityType.astNode?.fields || []).map((field) => {
    let type = field.type;

    // If a field is non-nullable, it's TypeNode will be wrapped with another NON_NULL_TYPE TypeNode.
    if (type.kind === Kind.NON_NULL_TYPE) {
      type = type.type;
    }

    if (type.kind === Kind.LIST_TYPE) {
      throw new Error(`Unhandled TypeNode: ${Kind.LIST_TYPE}`);
    }

    return {
      name: field.name.value,
      type: type.name.value,
    };
  });

  const filterFields: {
    [key: string]: { type: GraphQLInputType };
  } = {};

  // This is a helper map constructed during setup that is used by the resolver.
  const filterFieldNameToResolverConfig: {
    [key: string]: {
      fieldName: string;
      resolverConfig: FilterFieldResolverConfig;
    };
  } = {};

  // For each field on the entity, create a bunch of filter fields.
  entityFields.forEach((entityField) => {
    // Add the universal filter suffix fields.
    universalFilterSuffixes.forEach((suffix) => {
      const filterFieldName = `${entityField.name}${suffix}`;

      const scalarFilterFieldType = gqlScalarStringToType[entityField.type];
      const userDefinedFilterFieldType = userDefinedTypes[entityField.type];

      if (scalarFilterFieldType && userDefinedFilterFieldType) {
        throw new Error(
          `GQL Type name collision with scalar type: ${entityField.type}`
        );
      }

      const filterFieldType = scalarFilterFieldType
        ? scalarFilterFieldType
        : userDefinedFilterFieldType;

      if (!filterFieldType) {
        throw new Error(`GQL Type not found: ${entityField.type}`);
      }

      const resolverConfig = universalSuffixToResolverConfig[suffix];

      // TODO: Get to the bottom of the difference between GraphQLObjectType and GraphQLInputObjectType.
      // This could be buggy for complex types.
      const filterFieldTypeAssertedToInputType =
        filterFieldType as GraphQLInputType;

      let finalType: GraphQLInputType = filterFieldTypeAssertedToInputType;
      if (resolverConfig.isList) {
        finalType = new GraphQLList(filterFieldType);
      }

      filterFields[filterFieldName] = { type: finalType };
      filterFieldNameToResolverConfig[filterFieldName] = {
        fieldName: entityField.name,
        resolverConfig: universalSuffixToResolverConfig[suffix],
      };
    });

    // Add the numeric filter suffix fields.
    if (["ID", "Int", "Float"].includes(entityField.type)) {
      numericFilterSuffixes.forEach((suffix) => {
        const whereFieldName = `${entityField.name}${suffix}`;

        filterFields[whereFieldName] = { type: GraphQLString };
        filterFieldNameToResolverConfig[whereFieldName] = {
          fieldName: entityField.name,
          resolverConfig: numericSuffixToResolverConfig[suffix],
        };
      });
    }

    // Add the string filter suffix fields.
    if (entityField.type === "String") {
      stringFilterSuffixes.forEach((suffix) => {
        const whereFieldName = `${entityField.name}${suffix}`;

        filterFields[whereFieldName] = { type: GraphQLString };
        filterFieldNameToResolverConfig[whereFieldName] = {
          fieldName: entityField.name,
          resolverConfig: stringSuffixToResolverConfig[suffix],
        };
      });
    }
  });

  const filterType = new GraphQLInputObjectType({
    name: `${entityType.name}Filter`,
    fields: filterFields,
  });

  const resolver: PluralResolver = async (_, args, context) => {
    const { db } = context;
    const { where, first, skip, orderBy, orderDirection } = args;

    // TODO: migrate to use better-sqlite3
    // const entity = db
    // .prepare(`select * from \`${entityType.name}\` where id = '@id'`)
    // .get({ id: id });

    return [];

    // const query = db(entityType.name);

    // if (where) {
    //   for (const [field, value] of Object.entries(where)) {
    //     const { fieldName, resolverConfig } =
    //       filterFieldNameToResolverConfig[field];
    //     const { operator, patternPrefix, patternSuffix } = resolverConfig;

    //     let finalValue = value;

    //     if (patternPrefix) finalValue = patternPrefix + finalValue;
    //     if (patternSuffix) finalValue = finalValue + patternSuffix;

    //     query.where(fieldName, operator, finalValue);
    //   }
    // }
    // if (skip) query.offset(skip);
    // if (first) query.limit(first);
    // if (orderBy) query.orderBy(orderBy, orderDirection);

    // const records = await query;

    // return records;
  };

  return {
    type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(entityType))),
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
