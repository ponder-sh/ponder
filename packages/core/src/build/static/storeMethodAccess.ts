import type { StoreMethod } from "@/types/model.js";

export const storeMethodAccess = {
  create: ["write"],
  createMany: ["write"],
  update: ["read", "write"],
  updateMany: ["read", "write"],
  findUnique: ["read"],
  findMany: ["read"],
  upsert: ["read", "write"],
  delete: ["read", "write"],
} as const satisfies {
  [storeMethod in StoreMethod]:
    | readonly ["read"]
    | readonly ["write"]
    | readonly ["read", "write"];
};
