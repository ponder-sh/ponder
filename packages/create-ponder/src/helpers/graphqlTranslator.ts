import { gql } from "graphql-tag";

import type {
  DefinitionNode,
  NamedTypeNode,
  NonNullTypeNode,
} from "graphql/language";

const GraphqlTypesToPonderTypes = {
  ID: "string",
  String: "string",
  Int: "int",
  BigInt: "bigint",
  BigDecimal: "float",
  Float: "float",
  Boolean: "boolean",
  Bytes: "hex",
};

export function translateSchema(schema: string): string {
  const schemaAST = gql(schema);
  const result: string[] = [];
  const enums: string[] = [];
  const enumsResult: string[] = [];
  const idTypes: { [table: string]: string } = {};
  const referenceFields: { [table: string]: { [key: string]: string } } = {};
  const tables: {
    [table: string]: {
      columns: { [key: string]: string };
      descriptions: { [key: string]: string };
    };
  } = {};
  const joinedTables: { [name: string]: string } = {};

  // Parse enums
  // Need to do all the enums first before processing other types
  // because there is no other way to determine if a graphql definition is referring to
  // an enum or another table
  Object.keys(schemaAST.definitions).forEach((definitionName) => {
    const definition = schemaAST.definitions[
      definitionName as any as number
    ] as DefinitionNode;
    if (definition.kind === "EnumTypeDefinition") {
      const enumName = definition.name.value;
      enums.push(enumName);
      const values: string[] = [];
      definition.values?.forEach((value) => {
        values.push(value.name.value);
      });

      enumsResult.push(
        `	${enumName}: p.createEnum(${JSON.stringify(values)}),\n\n`,
      );
    }
  });

  // Record id types for ObjectTypeDefinition
  // This is needed for references later on
  Object.keys(schemaAST.definitions).forEach((definitionName) => {
    const definition = schemaAST.definitions[
      definitionName as any as number
    ] as DefinitionNode;
    if (definition.kind === "ObjectTypeDefinition") {
      const tableName = definition.name.value;
      definition.fields?.forEach((field) => {
        const fieldName = field.name.value;
        if (fieldName === "id") {
          const nonNullTypeNode = field.type as NonNullTypeNode;
          const namedTypeNode = nonNullTypeNode.type as NamedTypeNode;
          if (!namedTypeNode?.name?.value) {
            console.log(field);
            throw new Error(`Unsupported id type for ${tableName}`);
          }
          idTypes[tableName] =
            GraphqlTypesToPonderTypes[
              namedTypeNode.name.value as keyof typeof GraphqlTypesToPonderTypes
            ];
        }
      });
    }
  });

  // Parse fields for ObjectTypeDefinition
  Object.keys(schemaAST.definitions).forEach((definitionName) => {
    const definition = schemaAST.definitions[
      definitionName as any as number
    ] as DefinitionNode;
    if (definition.kind === "ObjectTypeDefinition") {
      const tableName = definition.name.value;
      tables[tableName] = { columns: {}, descriptions: {} };
      definition.fields?.forEach((field) => {
        const fieldName = field.name.value;
        tables[tableName]!.descriptions[fieldName] = field.description?.value
          ? `// ${field.description?.value}`
          : "";
        tables[tableName]!.columns[fieldName] = parseField(tableName, field);
      });
    }
  });

  // Assemble fields into result strings
  Object.keys(schemaAST.definitions).forEach((definitionName) => {
    const definition = schemaAST.definitions[
      definitionName as any as number
    ] as DefinitionNode;
    if (definition.kind === "ObjectTypeDefinition") {
      const tableName = definition.name.value;
      const columns = tables[tableName]!.columns;
      const descriptions = tables[tableName]!.descriptions;
      if (
        definition.directives?.some(
          (directive) => directive.name.value === "entity",
        )
      ) {
        result.push(
          `
	${tableName}: p.createTable({${Object.keys(columns)
    .map(
      (key) => `
		${descriptions[key]}
		${key}: ${columns[key]}`,
    )
    .join(", \n")},
		${Object.keys(referenceFields?.[tableName] ?? {})
      .map(
        (key) => `
		${key}: ${referenceFields![tableName]![key]}`,
      )
      .join(", \n")}
	}),\n`,
        );
      } else {
        throw new Error(
          `Unsupported directive: ${definition.directives?.[0]?.name.value}`,
        );
      }
    }
  });

  function parseField(tableName: string, field: any) {
    // Go down the levels until there's no more type
    let type = field.type;
    let levels: string[] = [];
    levels.unshift(type.kind);
    while (type.type) {
      type = type.type;
      levels.unshift(type.kind);
    }

    const baseType: string | undefined =
      GraphqlTypesToPonderTypes[
        type.name.value as keyof typeof GraphqlTypesToPonderTypes
      ];

    // Construct result
    let result = "";

    switch (true) {
      case enums.includes(type.name.value):
        // If enum, replace result
        result = result.concat(`p.enum("${type.name.value}")`);

        break;

      case !baseType: {
        // If not baseType, replace result
        const targetTableName = type.name.value;

        if (levels.includes("ListType")) {
          // Use joined tables if it's a list
          // there doesn't seem to be an easy way to differentiate one-to-many and many-to-many
          // transforming both to many-to-many solves this issue

          const joinedTableName = [tableName, targetTableName].sort().join("");
          result = result.concat(
            `p.many("${joinedTableName}.${lowerCaseFirstLetter(tableName)}Id")`,
          );

          // Generate the joined table
          const joinedTable = `${joinedTableName}: p.createTable({
            id: p.string(),
            ${lowerCaseFirstLetter(tableName)}Id: p.${
              idTypes[tableName]
            }().references("${tableName}.id"),
            ${lowerCaseFirstLetter(targetTableName)}Id: p.${
              idTypes[targetTableName]
            }().references("${targetTableName}.id"),
            ${lowerCaseFirstLetter(tableName)}: p.one("${lowerCaseFirstLetter(
              tableName,
            )}Id"),
            ${lowerCaseFirstLetter(
              targetTableName,
            )}: p.one("${lowerCaseFirstLetter(targetTableName)}Id"),
          }),\n\n`;

          joinedTables[joinedTableName] = joinedTable;

          // Remove list level since it's already dealt with
          levels = levels.filter((level) => level !== "ListType");
        } else {
          // Use references if it's not a list
          result = result.concat(`p.one("${field.name.value}Id")`);
          const referenceFieldName = `${field.name.value}Id`;

          const reference = `p.${
            idTypes[targetTableName]
          }().references("${targetTableName}.id")${
            levels.includes("NonNullType") ? "" : ".optional()"
          }`;

          if (!referenceFields[tableName]) {
            referenceFields[tableName] = {
              [referenceFieldName]: reference,
            };
          } else {
            referenceFields[tableName]![referenceFieldName] = reference;
          }

          // Remove all levels since it should all be accounted for
          levels = [];
        }

        break;
      }

      default:
        // baseType
        result = `p.${baseType}()`;
    }

    // Append as necessary
    for (let i = 0; i < levels.length; i++) {
      switch (levels[i]) {
        case "NamedType":
          break;
        case "NonNullType":
          break;
        case "ListType":
          // This should only be reached for base types with 1D lists
          result = result.concat(".list()");
          break;
        default:
          throw new Error(`Unsupported type: ${levels[i]} ${field}`);
      }
      // Append an .optional if needed
      const nextLevel = levels[i + 1] ?? "Optional";
      if (levels[i] !== "NonNullType" && nextLevel !== "NonNullType") {
        result = result.concat(".optional()");
      }
    }

    return result;
  }

  return `import { createSchema } from "@ponder/core";
 
export default createSchema((p) => ({${enumsResult.join("")}
${result.join("")}
${Object.values(joinedTables).join("")}
}));`;
}

function lowerCaseFirstLetter(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
