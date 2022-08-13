import {
  FieldDefinitionNode,
  GraphQLObjectType,
  GraphQLSchema,
  Kind,
} from "graphql";

import { getEntities } from "./helpers";

const generateEntityTypes = async (userSchema: GraphQLSchema) => {
  const entities = getEntities(userSchema);

  const body = entities.map(generateTypeForEntity).join("\n");

  // return { tables: tables };
};

const generateTypeForEntity = (entity: GraphQLObjectType) => {
  const fields = entity.astNode?.fields || [];

  return `
  type ${entity.name} = {
    ${fields.map(generateTypeForField).join(";")}
  }
  `;
};

const generateTypeForField = (field: FieldDefinitionNode) => {
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

  return `${field.name.value}${notNull || "?"}: ${1}`;
};

export { generateEntityTypes };
