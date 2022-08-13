import {
  FieldDefinitionNode,
  GraphQLNamedType,
  GraphQLSchema,
  Kind,
} from "graphql";

type DbSchema = {
  tables: {
    name: string;
    columns: {
      name: string;
      type: string;
      notNull: boolean;
    }[];
  }[];
};

const createDbSchema = async (userSchema: GraphQLSchema): Promise<DbSchema> => {
  // Find all types in the schema that are marked with the @entity directive.
  const entities = Object.values(userSchema.getTypeMap()).filter((type) => {
    const entityDirective = type.astNode?.directives?.find(
      (directive) => directive.name.value === "entity"
    );
    return !!entityDirective;
  });

  const tables = entities.map(getTableForEntity);

  return { tables: tables };
};

const getTableForEntity = (entity: GraphQLNamedType) => {
  if (entity.astNode?.kind !== "ObjectTypeDefinition") {
    throw new Error("@entity directive must only be applied to object types.");
  }

  const fields = entity.astNode.fields || [];
  const columns = fields.map(getColumnForField);

  return {
    name: entity.name,
    columns: columns,
  };
};

const getColumnForField = (field: FieldDefinitionNode) => {
  let notNull = false;
  let type = field.type;

  // If a field is non-nullable, it's TypeNode will be wrapped with another NON_NULL_TYPE TypeNode.
  if (type.kind === Kind.NON_NULL_TYPE) {
    notNull = true;
    type = type.type;
  }

  if (type.kind === Kind.LIST_TYPE) {
    throw new Error(`Unhandled TypeNode: ${Kind.LIST_TYPE}`);
  }

  return {
    name: field.name.value,
    type: type.name.value,
    notNull: notNull,
  };
};

export { createDbSchema };
export type { DbSchema };
