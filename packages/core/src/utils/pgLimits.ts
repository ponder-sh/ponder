/**
 * Postgres column limits.
 *
 * Kept apart from `./pg.ts` because these are the only things the rpc layer
 * needs from it, and `./pg.ts` imports the `pg` driver: depending on two
 * numbers should not mean depending on a database client.
 */

export const PG_BIGINT_MAX = 9223372036854775807n;
export const PG_INTEGER_MAX = 2147483647;
