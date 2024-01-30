import crypto from "crypto";
import type { Source } from "@/config/sources.js";
import type { Schema } from "@/schema/types.js";
import type { TableAccess } from "./parseAst.js";

export type TableIds = { [table: string]: string };

export const getTableIds = ({
  sources,
  tableAccess,
  schema,
}: { sources: Source[]; schema: Schema; tableAccess: TableAccess }) => {
  const tableIds: TableIds = {};

  for (const tableName of Object.keys(schema.tables)) {
    const seenKeys: Set<string> = new Set();

    const tableWrites = tableAccess
      .filter((t) => t.access === "write" && t.table === tableName)
      .filter((t) => {
        if (seenKeys.has(t.indexingFunctionKey)) {
          return false;
        } else {
          seenKeys.add(t.indexingFunctionKey);
          return true;
        }
      });

    const eventSources: string[] = [];

    for (const tableWrite of tableWrites) {
      const contractName = tableWrite.indexingFunctionKey.split(":")[0]!;
      const tableSources = sources.filter(
        (s) => s.contractName === contractName,
      );

      eventSources.push(
        JSON.stringify({
          astHash: tableWrite.hash,
          sources: tableSources,
        }),
      );
    }

    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(eventSources))
      .digest("hex");

    tableIds[tableName] = `${tableName}_${hash}`;
  }
  return tableIds;
};
