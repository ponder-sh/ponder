import { PgRemoteDatabase } from 'drizzle-orm/pg-proxy';
export { and, asc, avg, avgDistinct, between, count, countDistinct, desc, eq, exists, gt, gte, inArray, isNotNull, isNull, like, lt, lte, max, min, ne, not, notBetween, notExists, notIlike, notInArray, or, relations, sql, sum, sumDistinct } from 'drizzle-orm';
export { alias, except, exceptAll, intersect, intersectAll, union, unionAll } from 'drizzle-orm/pg-core';

declare const setDatabaseSchema: <T extends {
    [name: string]: unknown;
}>(schema: T, schemaName: string) => T;

type Schema = {
    [name: string]: unknown;
};
type Prettify<T> = {
    [K in keyof T]: T[K];
} & {};
type Client<schema extends Schema = Schema> = {
    db: Prettify<Omit<PgRemoteDatabase<schema>, "insert" | "update" | "delete" | "transaction" | "refreshMaterializedView" | "_">>;
};
declare const createClient: <schema extends Schema>(url: string, { schema }: {
    schema: schema;
}) => Client<schema>;

export { type Client, createClient, setDatabaseSchema };
