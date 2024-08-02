import { parse } from "graphql";

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

export function translateSchema(schema: string): {
  result: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const schemaAST = parse(schema);
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
      const name = pascalCase(definition.name.value);
      const values = definition.values?.map((value) => value.name.value) ?? [];
      enums.push(name);
      enumsResult.push(`${name}: p.createEnum(${JSON.stringify(values)}),\n\n`);
    }
  });

  // Record id types for ObjectTypeDefinition
  // This is needed for references later on
  Object.keys(schemaAST.definitions).forEach((definitionName) => {
    const definition = schemaAST.definitions[
      definitionName as any as number
    ] as DefinitionNode;
    if (definition.kind === "ObjectTypeDefinition") {
      const tableName = pascalCase(definition.name.value);
      definition.fields?.forEach((field) => {
        const fieldName = field.name.value;
        if (fieldName === "id") {
          const nonNullTypeNode = field.type as NonNullTypeNode;
          const namedTypeNode = nonNullTypeNode.type as NamedTypeNode;
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
      const tableName = pascalCase(definition.name.value);
      tables[tableName] = { columns: {}, descriptions: {} };
      definition.fields?.forEach((field) => {
        const fieldName = camelCase(field.name.value);
        tables[tableName]!.descriptions[fieldName] = field.description?.value
          ? `// ${field.description?.value}\n`
          : "";
        const columnDefinition = parseField(tableName, field);
        if (columnDefinition) {
          tables[tableName]!.columns[fieldName] = columnDefinition;
        }
      });
    }
  });

  // Assemble fields into result strings
  Object.keys(schemaAST.definitions).forEach((definitionName) => {
    const definition = schemaAST.definitions[
      definitionName as any as number
    ] as DefinitionNode;
    if (definition.kind === "ObjectTypeDefinition") {
      const tableName = pascalCase(definition.name.value);
      const columns = tables[tableName]!.columns;
      const descriptions = tables[tableName]!.descriptions;
      if (
        definition.directives?.some(
          (directive) => directive.name.value === "entity",
        )
      ) {
        result.push(
          `${tableName}: p.createTable({${Object.keys(columns)
            .map((key) => `${descriptions[key]}${key}: ${columns[key]}`)
            .join(", \n")},
            ${Object.keys(referenceFields?.[tableName] ?? {})
              .map((key) => `${key}: ${referenceFields![tableName]![key]}`)
              .join(", \n")}}),\n
          `,
        );
      } else {
        warnings.push(
          `Unsupported directive in schema.graphql: ${definition.directives?.[0]?.name.value}. Currently only @entity is supported`,
        );
      }
    }
  });

  function parseField(tableName: string, field: any): string | undefined {
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
        const targetTableName = pascalCase(type.name.value);

        if (levels.includes("ListType")) {
          // Use joined tables if it's a list
          // there doesn't seem to be an easy way to differentiate one-to-many and many-to-many
          // transforming both to many-to-many solves this issue

          // If the list is self-referencing, distinguish parent and child
          const childMethodName =
            tableName === targetTableName
              ? `child${pascalCase(tableName)}`
              : camelCase(tableName);

          const parentMethodName =
            tableName === targetTableName
              ? `parent${pascalCase(targetTableName)}`
              : camelCase(targetTableName);

          const joinedTableName = [tableName, targetTableName].sort().join("");
          result = result.concat(
            `p.many("${joinedTableName}.${childMethodName}Id")`,
          );

          // Generate the joined table
          const joinedTable = `${joinedTableName}: p.createTable({
            id: p.string(),
            ${camelCase(childMethodName)}Id: p.${
              idTypes[tableName]
            }().references("${tableName}.id"),
            ${camelCase(parentMethodName)}Id: p.${
              idTypes[targetTableName]
            }().references("${targetTableName}.id"),
            ${camelCase(childMethodName)}: p.one("${childMethodName}Id"),
            ${camelCase(parentMethodName)}: p.one("${parentMethodName}Id"),}),\n
          `;

          joinedTables[joinedTableName] = joinedTable;

          // Remove list level since it's already dealt with
          levels = levels.filter((level) => level !== "ListType");
        } else {
          // Use one-to-one references if it's not a list

          const fieldName = camelCase(field.name.value);
          result = result.concat(`p.one("${fieldName}Id")`);
          const referenceFieldName = `${fieldName}Id`;

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
          warnings.push(`Unsupported type: ${tableName} ${levels[i]} ${field}`);
          return undefined;
      }
      // Append an .optional if needed
      const nextLevel = levels[i + 1] ?? "Optional";
      if (levels[i] !== "NonNullType" && nextLevel !== "NonNullType") {
        result = result.concat(".optional()");
      }
    }

    return result;
  }

  return {
    result: `import { createSchema } from "@ponder/core";
      export default createSchema((p) => ({
        ${enumsResult.join("")}

        ${result.join("")}

        ${Object.values(joinedTables).join("")}
      }));`,
    warnings,
  };
}

function camelCase(s: string): string {
  if (s.length === 0) {
    return "";
  }

  // Replace the underscore with a 'u' if it's the first character
  if (s[0] === "_") {
    while (s[0] === "_") {
      s = s.slice(1);
      s = s.charAt(0).toUpperCase() + s.slice(1);
      s = "u".concat(s);
    }
  }

  // Convert UPPERCASE if needed
  if (s === s.toUpperCase()) {
    s = s.toLowerCase();
  }

  // Convert snake_case if needed
  if (s.includes("_")) {
    s = s
      .split("_")
      .map((word) => word.toLowerCase())
      .map((word) => (word[0]?.toUpperCase() ?? "") + (word.slice(1) ?? ""))
      .join("");
  }

  return s.charAt(0).toLowerCase() + s.slice(1);
}

function pascalCase(s: string): string {
  s = camelCase(s);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
