import Emittery from "emittery";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { HMRPayload, Plugin } from "vite";

import type { Prettify } from "@/types/utils";

type ExtractPayloadType<T> = T extends { type: infer PT } ? PT : never;
type ExtractPayload<T, PT> = T extends { type: PT }
  ? Prettify<Omit<T, "type">>
  : never;
type HMREvents = {
  [P in HMRPayload as ExtractPayloadType<P>]: ExtractPayload<
    HMRPayload,
    ExtractPayloadType<P>
  >;
};

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
declare module "vite" {
  interface ViteDevServer {
    emitter: Emittery<HMREvents>;
  }
}

/**
 * Vite emits HMR events via a Websocket server to clients, but does not
 * offer hooks for listening to those events server-side. This plugin attaches
 * an event emitter to the dev server that forwards all `ws.send` method calls.
 *
 * This approach is inspired by a similar plugin included in `vite-node`.
 * https://github.com/vitest-dev/vitest/blob/76607ead169733f27e241554bca01f10e81ea849/packages/vite-node/src/hmr/emitter.ts
 */
export function ponderHmrEventWrapperPlugin(): Plugin {
  const emitter = new Emittery<HMREvents>();
  return {
    name: "ponder:hmr-event-wrapper",
    configureServer(server) {
      const _send = server.ws.send;
      server.emitter = emitter;
      server.ws.send = function (payload: HMRPayload) {
        _send(payload);
        const { type, ...rest } = payload;
        emitter.emit(type, rest);
      };
    },
  };
}
