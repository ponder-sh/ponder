import type {
  Abi,
  AbiEvent,
  AbiFunction,
  AbiParametersToPrimitiveTypes,
  FormatAbiItem,
} from "abitype";
import type { GetEventArgs, ParseAbiItem } from "viem";

export type NonStrictPick<T, K> = {
  [P in Extract<keyof T, K>]: T[P];
};

export type ExtractAbiEvents<
  abi extends Abi,
  events = Extract<abi[number], { type: "event" }>,
> = [events] extends [never] ? AbiEvent : events;

export type ExtractAbiFunctions<
  abi extends Abi,
  functions = Extract<abi[number], { type: "function" }>,
> = [functions] extends [never] ? AbiFunction : functions;

/** Return the abi event given the abi and compact signature. */
export type ParseAbiEvent<
  abi extends Abi,
  signature extends string,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
  noOverloadEvent = Extract<abiEvents, { name: signature }>,
  overloadEvent = Extract<abiEvents, ParseAbiItem<`event ${signature}`>>,
> = [noOverloadEvent] extends [never]
  ? [overloadEvent] extends [never]
    ? AbiEvent
    : overloadEvent
  : noOverloadEvent;

/** Return the abi function given the abi and compact signature. */
export type ParseAbiFunction<
  abi extends Abi,
  signature extends string,
  ///
  abiFunctions extends AbiFunction = ExtractAbiFunctions<abi>,
  noOverloadFunction = Extract<
    abiFunctions,
    { name: signature extends `${infer _signature}()` ? _signature : never }
  >,
  overloadFunction = Extract<
    abiFunctions,
    ParseAbiItem<`function ${signature}`>
  >,
> = [overloadFunction] extends [never]
  ? [noOverloadFunction] extends [never]
    ? AbiFunction
    : noOverloadFunction
  : overloadFunction;

/** Return the compact signature given the abi and abi event. */
export type FormatAbiEvent<
  abi extends Abi,
  event extends AbiEvent,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
  matchingNameEvents extends AbiEvent = Extract<
    abiEvents,
    { name: event["name"] }
  >,
> = [matchingNameEvents] extends [never]
  ? Abi extends abi
    ? event["name"]
    : never
  : [Exclude<matchingNameEvents, event>] extends [never]
    ? event["name"]
    : FormatAbiItem<event> extends `event ${infer signature}`
      ? signature
      : never;

/** Return the compact signature given the abi and abi function. */
export type FormatAbiFunction<
  abi extends Abi,
  _function extends AbiFunction,
  ///
  abiFunctions extends AbiFunction = ExtractAbiFunctions<abi>,
  matchingNameFunctions extends AbiFunction = Extract<
    abiFunctions,
    { name: _function["name"] }
  >,
> = [matchingNameFunctions] extends [never]
  ? Abi extends abi
    ? `${_function["name"]}()`
    : never
  : [Exclude<matchingNameFunctions, _function>] extends [never]
    ? `${_function["name"]}()`
    : FormatAbiItem<_function> extends `function ${infer signature}`
      ? signature
      : never;

/**
 * Return an union of safe event names that handle event overridding.
 */
export type SafeEventNames<
  abi extends Abi,
  ///
  abiEvents extends AbiEvent = ExtractAbiEvents<abi>,
> = abiEvents extends abiEvents ? FormatAbiEvent<abi, abiEvents> : never;

/**
 * Return an union of safe function names that handle function overridding.
 */
export type SafeFunctionNames<
  abi extends Abi,
  ///
  abiFunctions extends AbiFunction = ExtractAbiFunctions<abi>,
> = abiFunctions extends abiFunctions
  ? FormatAbiFunction<abi, abiFunctions>
  : never;

export type FormatEventArgs<
  abi extends Abi,
  signature extends string,
> = GetEventArgs<
  Abi,
  string,
  {
    EnableUnion: false;
    IndexedOnly: false;
    Required: true;
  },
  ParseAbiEvent<abi, signature>
>;

export type FormatFunctionArgs<
  abi extends Abi,
  signature extends string,
  ///
  args = AbiParametersToPrimitiveTypes<
    ParseAbiFunction<abi, signature>["inputs"]
  >,
> = readonly [] extends args ? never : args;

export type FormatFunctionResult<
  abi extends Abi,
  signature extends string,
  ///
  result = AbiParametersToPrimitiveTypes<
    ParseAbiFunction<abi, signature>["outputs"]
  >,
> = readonly [] extends result
  ? never
  : result extends readonly [unknown]
    ? result[0]
    : result;
