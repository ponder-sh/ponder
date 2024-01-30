import crypto from "crypto";
import type { Source } from "@/config/sources.js";
import type { Schema } from "@/schema/types.js";
import type { TableAccess } from "./parseAst.js";

export type FunctionIds = { [func: string]: string };
export type TableIds = { [table: string]: string };

export const getIds = ({
  sources,
  tableAccess,
  schema,
}: { sources: Source[]; schema: Schema; tableAccess: TableAccess }) => {
  const functionIds: FunctionIds = {};
  const tableIds: TableIds = {};

  const seenKeys: Set<string> = new Set();
  const tableWrites = tableAccess
    .filter((t) => t.access === "write")
    .filter((t) => {
      if (seenKeys.has(t.indexingFunctionKey)) {
        return false;
      } else {
        seenKeys.add(t.indexingFunctionKey);
        return true;
      }
    });

  for (const { hash, indexingFunctionKey } of tableWrites) {
    const contractName = indexingFunctionKey.split(":")[0]!;
    const tableSources = sources.filter((s) => s.contractName === contractName);

    const _hash = crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          astHash: hash,
          sournces: tableSources,
        }),
      )
      .digest("hex");

    functionIds[indexingFunctionKey] = _hash;
  }

  for (const tableName of Object.keys(schema.tables)) {
    const eventSources = tableWrites
      .filter((t) => t.access === tableName)
      .map((t) => functionIds[t.indexingFunctionKey]!);

    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(eventSources))
      .digest("hex");

    tableIds[tableName] = `${tableName}_${hash}`;
  }
  return { tableIds, functionIds };
};
