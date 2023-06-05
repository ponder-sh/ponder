export type Model<T extends { id: string | number | bigint }> = {
  create: (options: { id: T["id"]; data: Omit<T, "id"> }) => Promise<T>;

  update: (options: {
    id: T["id"];
    data: Omit<Partial<T>, "id">;
  }) => Promise<T>;

  upsert: (options: {
    id: T["id"];
    create: Omit<T, "id">;
    update: Omit<Partial<T>, "id">;
  }) => Promise<T>;

  findUnique: (options: { id: T["id"] }) => Promise<T | null>;

  delete: (options: { id: T["id"] }) => Promise<boolean>;
};
