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
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
} from "graphql";
import { Knex } from "knex";

import { getEntities } from "../utils/helpers";

type Source = { request: unknown };
type Context = { db: Knex<Record<string, unknown>, unknown[]> };

type SingularArgs = {
  id?: string;
};
type SingularResolver = GraphQLFieldResolver<Source, Context, SingularArgs>;

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

const buildGqlSchema = (userSchema: GraphQLSchema): GraphQLSchema => {
  const entities = getEntities(userSchema);

  const fields: { [fieldName: string]: GraphQLFieldConfig<Source, Context> } =
    {};

  for (const entity of entities) {
    const singularFieldName =
      entity.name.charAt(0).toLowerCase() + entity.name.slice(1);
    fields[singularFieldName] = createSingularField(entity);

    const pluralFieldName = singularFieldName + "s";
    fields[pluralFieldName] = createPluralField(entity);
  }

  const queryType = new GraphQLObjectType({
    name: "Query",
    fields: fields,
  });

  const schema = new GraphQLSchema({ query: queryType });

  return schema;
};

const createSingularField = (
  entity: GraphQLObjectType
): GraphQLFieldConfig<Source, Context> => {
  const resolver: SingularResolver = async (_, args, context) => {
    const { db } = context;
    const { id } = args;
    if (!id) return null;

    const query = db(entity.name).where({ id: id });
    const records = await query;

    return records[0] || null;
  };

  return {
    type: entity,
    args: {
      id: { type: new GraphQLNonNull(GraphQLID) },
    },
    resolve: resolver,
  };
};

const gqlScalarStringToType: { [key: string]: GraphQLScalarType } = {
  ID: GraphQLID,
  Int: GraphQLInt,
  Float: GraphQLFloat,
  String: GraphQLString,
  Boolean: GraphQLBoolean,
};

type WhereFieldResolverData = {
  operator: string;
  isList?: boolean;
  patternPrefix?: string;
  patternSuffix?: string;
};

const whereClauseSuffixToResolverData: {
  [key: string]: WhereFieldResolverData;
} = {
  _not: { operator: "!=" },
  _gt: { operator: ">" },
  _lt: { operator: "<" },
  _gte: { operator: ">=" },
  _lte: { operator: "<=" },
  _in: { operator: "in", isList: true },
  _not_in: { operator: "not in", isList: true },
};
const whereClauseSuffixes = Object.keys(whereClauseSuffixToResolverData);

const stringWhereClauseSuffixToResolverData: {
  [key: string]: WhereFieldResolverData;
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
const stringWhereClauseSuffixes = Object.keys(
  stringWhereClauseSuffixToResolverData
);

const createPluralField = (
  entity: GraphQLObjectType
): GraphQLFieldConfig<Source, Context> => {
  const entityFields = (entity.astNode?.fields || []).map((field) => {
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

  const whereFields: {
    [key: string]: { type: GraphQLInputType };
  } = {};

  // This is a helper map constructed during setup that is used by the resolver.
  const whereFieldNameToResolverData: {
    [key: string]: {
      fieldName: string;
      resolverData: WhereFieldResolverData;
    };
  } = {};

  // For each field on the entity, create a bunch of where clause fields.
  entityFields.forEach((entityField) => {
    // Add the universal where clause suffix fields.
    whereClauseSuffixes.forEach((suffix) => {
      const whereFieldName = `${entityField.name}${suffix}`;
      const whereFieldType = gqlScalarStringToType[entityField.type];

      const resolverData = whereClauseSuffixToResolverData[suffix];

      let finalType: GraphQLInputType = whereFieldType;
      if (resolverData.isList) {
        finalType = new GraphQLList(whereFieldType);
      }

      whereFields[whereFieldName] = { type: finalType };
      whereFieldNameToResolverData[whereFieldName] = {
        fieldName: entityField.name,
        resolverData: whereClauseSuffixToResolverData[suffix],
      };
    });

    // Add the String-only where clause suffix fields.
    if (entityField.type === "String") {
      stringWhereClauseSuffixes.forEach((suffix) => {
        const whereFieldName = `${entityField.name}${suffix}`;

        whereFields[whereFieldName] = { type: GraphQLString };
        whereFieldNameToResolverData[whereFieldName] = {
          fieldName: entityField.name,
          resolverData: stringWhereClauseSuffixToResolverData[suffix],
        };
      });
    }
  });

  const whereInputType = new GraphQLInputObjectType({
    name: `${entity.name}WhereInput`,
    fields: whereFields,
  });

  const resolver: PluralResolver = async (_, args, context) => {
    const { db } = context;
    const { where, first, skip, orderBy, orderDirection } = args;

    const query = db(entity.name);

    if (where) {
      for (const [field, value] of Object.entries(where)) {
        const { fieldName, resolverData } = whereFieldNameToResolverData[field];
        const { operator, patternPrefix, patternSuffix } = resolverData;

        let finalValue = value;

        if (patternPrefix) finalValue = patternPrefix + finalValue;
        if (patternSuffix) finalValue = finalValue + patternSuffix;

        query.where(fieldName, operator, finalValue);
      }
    }
    if (skip) query.offset(skip);
    if (first) query.limit(first);
    if (orderBy) query.orderBy(orderBy, orderDirection);

    const records = await query;

    return records;
  };

  return {
    type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(entity))),
    args: {
      where: { type: whereInputType },
      first: { type: GraphQLInt },
      skip: { type: GraphQLInt },
      orderBy: { type: GraphQLString },
      orderDirection: { type: GraphQLString },
    },
    resolve: resolver,
  };
};

export { buildGqlSchema };
