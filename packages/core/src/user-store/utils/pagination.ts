import { createGraphQLError } from "graphql-yoga";

const MAX_SKIP = 5000;

export function validateSkip(skip: number) {
  if (skip > MAX_SKIP) {
    throw createGraphQLError(
      `Invalid query. Cannot skip more than 5000 rows. Received: ${skip} rows.`
    );
  }
  return skip;
}

const MAX_TAKE = 1000;

export function validateTake(take: number) {
  if (take > MAX_TAKE) {
    throw createGraphQLError(
      `Invalid query. Cannot take more than 1000 rows. Received: ${take} rows.`
    );
  }
  return take;
}
