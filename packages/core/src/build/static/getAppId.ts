import crypto from "node:crypto";
import type { Source } from "@/config/sources.js";
import type { Schema } from "@/schema/types.js";
import { type TableAccess } from "./getTableAccess.js";

export const HASH_VERSION = 3;

type Identifier = {
  version: number;

  functions: {
    name: string;
    hash: string;
  }[];

  sources: object[];
  schema: object;
};

export const getAppId = ({
  sources,
  tableAccess,
  schema,
}: {
  sources: Source[];
  schema: Schema;
  tableAccess: TableAccess;
}) => {
  const id: Omit<Identifier, "version"> = {
    functions: [],
    sources,
    schema,
  };

  // Build function inputs
  for (const [indexingFunctionKey, { hash }] of Object.entries(tableAccess)) {
    id.functions.push({ name: indexingFunctionKey, hash });
  }

  return hashIdentifier(id);
};

const hashIdentifier = (schema: Omit<Identifier, "version">) => {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ ...schema, version: HASH_VERSION }))
    .digest("hex")
    .slice(0, 10);
};

export function safeGetAppId({
  sources,
  tableAccess,
  schema,
}: {
  sources: Source[];
  schema: Schema;
  tableAccess: TableAccess;
}) {
  try {
    const appId = getAppId({
      sources,
      schema,
      tableAccess,
    });

    return { success: true, data: { appId } } as const;
  } catch (error_) {
    const error = error_ as Error;
    error.stack = undefined;
    return { success: false, error } as const;
  }
}
