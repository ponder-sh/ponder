import type { Database } from "better-sqlite3";

type Source = { request: unknown };
type Context = { db: Database };

export type { Context, Source };
