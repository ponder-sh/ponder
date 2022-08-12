import fs from "fs";
import {
  buildSchema,
  FieldDefinitionNode,
  GraphQLNamedType,
  Kind,
} from "graphql";

import { toolConfig } from "./config";

const schemaHeader = `
"Directs the executor to process this type as a Ponder entity."
directive @entity(
  immutable: Boolean = false
) on OBJECT
`;

const processSchema = async () => {
  const schemaBody = fs.readFileSync(toolConfig.pathToSchemaFile).toString();
  const schemaSource = schemaHeader + schemaBody;
  const schema = buildSchema(schemaSource);

  // Find all types in the schema that are marked with the @entity directive.
  const entities = Object.values(schema.getTypeMap()).filter((type) => {
    const entityDirective = type.astNode?.directives?.find(
      (directive) => directive.name.value === "entity"
    );
    return !!entityDirective;
  });

  const dbDefinition = entities.map(getTableDefinitionForEntity);

  return dbDefinition;
};

const getTableDefinitionForEntity = (entity: GraphQLNamedType) => {
  if (entity.astNode?.kind !== "ObjectTypeDefinition") {
    throw new Error("@entity directive must only be applied to object types.");
  }

  const fields = entity.astNode.fields || [];
  const columnDefinitions = fields.map(getColumnDefinitionForField);

  return {
    tableName: entity.name,
    columnDefinitions: columnDefinitions,
  };
};

const getColumnDefinitionForField = (field: FieldDefinitionNode) => {
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
    columnName: field.name.value,
    type: type.name.value,
    notNull: notNull,
  };
};

export { processSchema };
