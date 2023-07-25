import { Prettify } from "./utils";

type HasOnlyIdProperty<T> = Exclude<keyof T, "id"> extends never ? true : false;

type RequiredKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

type HasRequiredPropertiesOtherThanId<T> = Exclude<
  RequiredKeys<T>,
  "id"
> extends never
  ? false
  : true;

export type Model<T extends { id: string | number | bigint }> = {
  create: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasOnlyIdProperty<T> extends true
        ? { data?: never }
        : HasRequiredPropertiesOtherThanId<T> extends true
        ? { data: Prettify<Omit<T, "id">> }
        : { data?: Prettify<Omit<T, "id">> })
    >
  ) => Promise<T>;

  update: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasOnlyIdProperty<T> extends true
        ? { data?: never }
        : HasRequiredPropertiesOtherThanId<T> extends true
        ? { data: Prettify<Omit<Partial<T>, "id">> }
        : { data?: Prettify<Omit<Partial<T>, "id">> })
    >
  ) => Promise<T>;

  upsert: (
    options: Prettify<
      {
        id: T["id"];
      } & (HasOnlyIdProperty<T> extends true
        ? { create?: never; update?: never }
        : HasRequiredPropertiesOtherThanId<T> extends true
        ? {
            create: Prettify<Omit<T, "id">>;
            update: Prettify<Omit<Partial<T>, "id">>;
          }
        : {
            create?: Prettify<Omit<T, "id">>;
            update?: Prettify<Omit<Partial<T>, "id">>;
          })
    >
  ) => Promise<T>;

  findUnique: (options: { id: T["id"] }) => Promise<T | null>;

  delete: (options: { id: T["id"] }) => Promise<boolean>;
};
