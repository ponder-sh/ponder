import type { Knex } from "knex";

type Source = { request: unknown };
type Context = { db: Knex<Record<string, unknown>, unknown[]> };

export type { Context, Source };
