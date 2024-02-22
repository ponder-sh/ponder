export const ormAccess = {
  create: ["write"],
  update: ["read", "write"],
  upsert: ["read", "write"],
  delete: ["write"],
  findUnique: ["read"],
  findMany: ["read"],
  createMany: ["write"],
  updateMany: ["read", "write"],
} as const;

export type ORMMethods = keyof typeof ormAccess;
