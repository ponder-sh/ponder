import fs from "fs";
import type { FieldDefinitionNode, GraphQLNamedType } from "graphql";
import { buildSchema } from "graphql";

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

  for (const entity of entities) {
    processEntityType(entity);
  }
};

const processEntityType = (entity: GraphQLNamedType) => {
  if (entity.astNode?.kind !== "ObjectTypeDefinition") {
    throw new Error("@entity directive must only be applied to object types.");
  }

  const fields = entity.astNode.fields || [];

  for (const field of fields) {
    processField(field);
  }
};

const processField = (field: FieldDefinitionNode) => {
  console.log({ field });
};

export { processSchema };
