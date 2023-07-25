import { Prettify } from "./utils";

type HasRequiredFieldsOtherThanId<T> = Exclude<keyof T, "id"> extends never
  ? false
  : true;

export type Model<T extends { id: string | number | bigint }> = {
  create: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasRequiredFieldsOtherThanId<T> extends true
        ? { data: Omit<T, "id"> }
        : { data?: never })
    >
  ) => Promise<T>;

  update: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasRequiredFieldsOtherThanId<T> extends true
        ? { data: Omit<Partial<T>, "id"> }
        : { data?: never })
    >
  ) => Promise<T>;

  upsert: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasRequiredFieldsOtherThanId<T> extends true
        ? {
            create: Omit<T, "id">;
            update: Omit<Partial<T>, "id">;
          }
        : { create?: never; update?: never })
    >
  ) => Promise<T>;

  findUnique: (options: { id: T["id"] }) => Promise<T | null>;

  delete: (options: { id: T["id"] }) => Promise<boolean>;
};
