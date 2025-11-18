type Index = any;
type Column = any;

interface JsonCreateTableStatement {
  type: "create_table";
  tableName: string;
  schema: string;
  columns: Column[];
  compositePKs: string[];
  compositePkName?: string;
  uniqueConstraints?: string[];
  checkConstraints?: string[];
}

type JsonCreatePgViewStatement = {
  type: "create_view";
  name: string;
  schema: string;
  definition?: string;
  materialized: boolean;
  with: any;
  withNoData?: boolean;
  using?: string;
  tablespace?: string;
};

interface JsonCreateEnumStatement {
  type: "create_type_enum";
  name: string;
  schema: string;
  values: string[];
}

interface JsonPgCreateIndexStatement {
  type: "create_index_pg";
  tableName: string;
  data: Index;
  schema: string;
}

export type JsonSchema = {
  schema: string;
  tables: {
    json: JsonCreateTableStatement[];
  };
  views: {
    json: JsonCreatePgViewStatement[];
  };
  enums: {
    json: JsonCreateEnumStatement[];
  };
  indexes: { json: JsonPgCreateIndexStatement[] };
};

export function filterReorgTables(
  tables: JsonCreateTableStatement[],
): JsonCreateTableStatement[] {
  return tables.filter((table) => !table.tableName.startsWith("_reorg__"));
}
