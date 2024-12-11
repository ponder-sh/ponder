import { PgRemoteDatabase } from 'drizzle-orm/pg-proxy';

type Schema = {
    [name: string]: unknown;
};
type Client<schema extends Schema = Schema> = {
    db: PgRemoteDatabase<schema>;
};
declare const createClient: <schema extends Schema>({ url, schema, }: {
    url: string;
    schema: schema;
}) => Client<schema>;

export { type Client, createClient };
