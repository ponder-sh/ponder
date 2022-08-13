import {
  GraphQLFieldResolver,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNamedType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  Kind,
} from "graphql";
import { Knex } from "knex";

type Source = { request: any };
type Context = { db: Knex<any, unknown[]> };

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

const createGqlSchema = async (
  userSchema: GraphQLSchema
): Promise<GraphQLSchema> => {
  // Find all types in the schema that are marked with the @entity directive.
  const entities = Object.values(userSchema.getTypeMap()).filter((type) => {
    const entityDirective = type.astNode?.directives?.find(
      (directive) => directive.name.value === "entity"
    );
    return !!entityDirective;
  });

  const fields: { [fieldName: string]: any } = {};

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

const createSingularField = (entity: GraphQLNamedType) => {
  if (entity.astNode?.kind !== Kind.OBJECT_TYPE_DEFINITION) {
    throw new Error(`Invalid node type for entity: ${entity.astNode?.kind}`);
  }

  const resolver: SingularResolver = async (_, args, context) => {
    const { db } = context;
    const { id } = args;
    if (!id) {
      return null;
    }

    const records = await db(entity.name).where({ id: id });
    return records[0] || null;
  };

  return {
    // NOTE: This is weird, I think this entity only happens to conform to the type interface expected.
    // These GraphQL types are fucking wild.
    type: entity,
    args: {
      id: { type: GraphQLID },
    },
    resolve: resolver,
  };
};

// const gqlPrimitiveTo
// 1) Get the GQL primiitve type
// 2) add any wrapper types to map below
// 3) compose that shit in the

const whereClauseSuffixtoSqlOperatorMap = {
  // _: null,
  _not: "not",
  _gt: ">",
  _lt: "<",
  _gte: ">=",
  _lte: "<=",
  _in: "in",
  _not_in: "not in",
  // _contains: null,
  // _contains_nocase: null,
  // _not_contains: null,
  // _not_contains_nocase: null,
  // _starts_with: null,
  // _starts_with_nocase: null,
  // _ends_with: null,
  // _ends_with_nocase: null,
  // _not_starts_with: null,
  // _not_starts_with_nocase: null,
  // _not_ends_with: null,
  // _not_ends_with_nocase: null,
};
const whereClauseSuffixes = Object.keys(whereClauseSuffixtoSqlOperatorMap);

const createPluralField = (entity: GraphQLNamedType) => {
  if (!entity.astNode || entity.astNode.kind !== Kind.OBJECT_TYPE_DEFINITION) {
    throw new Error(`Invalid node type for entity: ${entity.astNode?.kind}`);
  }

  const entityFields = (entity.astNode.fields || []).map((field) => {
    console.log({ name: field.name, type: field.type });

    let type = field.type;

    // If a field is non-nullable, it's TypeNode will be wrapped with another NON_NULL_TYPE TypeNode.
    if (type.kind === Kind.NON_NULL_TYPE) {
      type = type.type;
    }

    console.log({ baseType: type });

    return {
      name: field.name.value,
      // type:
    };
  });

  const whereFields: { [key: string]: { type: GraphQLScalarType } } = {};

  entityFields.forEach((entityField) => {
    whereClauseSuffixes.forEach((suffix) => {
      whereFields[`${entityField.name}${suffix}`] = { type: GraphQLInt }; // compose shit here
    });
  });

  const whereInputType = new GraphQLInputObjectType({
    name: `${entity.name}WhereInput`,
    fields: whereFields,
  });

  const resolver: PluralResolver = async (_, args, context) => {
    const { db } = context;
    const { where, first, skip, orderBy, orderDirection } = args;

    const query = db(entity.name);

    // TODO: support a range of queries for all params
    if (where) {
      if (where.id_gt) {
        query.where("id", ">", where.id_gt);
      }
    }
    if (skip) query.offset(skip);
    if (first) query.limit(first);
    if (orderBy) query.orderBy(orderBy, orderDirection);

    const records = await query;

    return records;
  };

  return {
    // NOTE: This is weird, I think this entity only happens to conform to the type interface expected.
    // These GraphQL types are fucking wild.
    type: new GraphQLList(entity),
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

export { createGqlSchema };
