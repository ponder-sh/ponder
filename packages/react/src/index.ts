export { PonderContext, PonderProvider } from "./context.js";
export {
  usePonderClient,
  usePonderQuery,
  usePonderQueryOptions,
  usePonderStatus,
} from "./hook.js";
export { getPonderQueryOptions } from "./utils.js";

// biome-ignore lint/suspicious/noEmptyInterface: Required for module augmentation.
export interface Register {}

export type ResolvedSchema = Register extends { schema: infer schema }
  ? schema
  : {
      [name: string]: unknown;
    };
