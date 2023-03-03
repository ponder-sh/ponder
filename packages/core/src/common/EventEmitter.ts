import NodeEventEmitter from "node:events";
import TypedEmitter, { EventMap } from "typed-emitter";

export class EventEmitter<T extends EventMap> extends (NodeEventEmitter as {
  new <T extends EventMap>(): TypedEmitter<T>;
})<T> {}
