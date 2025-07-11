export { PonderProvider, PonderContext } from "./context.js";
export {
  usePonderQuery,
  usePonderStatus,
  usePonderClient,
  usePonderQueryOptions,
} from "./hook.js";
export { getPonderQueryOptions } from "./utils.js";

// biome-ignore lint/suspicious/noEmptyInterface: <explanation>
export interface Register {}

export type ResolvedSchema = Register extends { schema: infer schema }
  ? schema
  : {
      [name: string]: unknown;
    };
