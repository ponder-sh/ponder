import type { ApiRegistry } from "@/types/api.js";
import type { BlankInput, HandlerResponse, Input, Next } from "hono/types";
import type { Context, MiddlewareContext } from "./context.js";

export type Handler<
  path extends string = any,
  input extends Input = BlankInput,
  response extends HandlerResponse<any> = any,
> = (c: Context<path, input>) => response;

export type MiddlewareHandler<
  path extends string = string,
  input extends Input = {},
> = (c: MiddlewareContext<path, input>, next: Next) => Promise<Response | void>;

type BasePath = "/";

export type HandlerInterface = {
  // app.get(handler)
  <
    path extends string = BasePath,
    input extends Input = BlankInput,
    response extends HandlerResponse<any> = any,
  >(
    handler: Handler<path, input, response>,
  ): ApiRegistry;

  // app.get(handler x2)
  <
    path extends string = BasePath,
    input extends Input = BlankInput,
    input2 extends Input = input,
    response extends HandlerResponse<any> = any,
  >(
    ...handlers: [Handler<path, input>, Handler<path, input2, response>]
  ): ApiRegistry;

  // app.get(path, handler)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
  >(
    path: path,
    handler: Handler<path, input, response>,
  ): ApiRegistry;

  // app.get(handler x 3)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
  >(
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      Handler<path, input3, response>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x2)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<path, input>,
      Handler<path, input2, response>,
    ]
  ): ApiRegistry;

  // app.get(handler x 4)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
  >(
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      Handler<path, input4, response>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x3)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      Handler<path, input3, response>,
    ]
  ): ApiRegistry;

  // app.get(handler x 5)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
  >(
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      Handler<path, input5, response>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x4)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      Handler<path, input4, response>,
    ]
  ): ApiRegistry;

  // app.get(handler x 6)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
  >(
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      Handler<path, input6, response>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x5)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      Handler<path, input5, response>,
    ]
  ): ApiRegistry;

  // app.get(handler x 7)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
    input7 extends Input = input & input2 & input3 & input4 & input5 & input6,
  >(
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      MiddlewareHandler<path, input6>,
      Handler<path, input7, response>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x6)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      Handler<path, input6, response>,
    ]
  ): ApiRegistry;

  // app.get(handler x 8)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
    input7 extends Input = input & input2 & input3 & input4 & input5 & input6,
    input8 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7,
  >(
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      MiddlewareHandler<path, input6>,
      MiddlewareHandler<path, input7>,
      Handler<path, input8, response>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x7)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
    input7 extends Input = input & input2 & input3 & input4 & input5 & input6,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      MiddlewareHandler<path, input6>,
      Handler<path, input7, response>,
    ]
  ): ApiRegistry;

  // app.get(handler x 9)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
    input7 extends Input = input & input2 & input3 & input4 & input5 & input6,
    input8 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7,
    input9 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7 &
      input8,
  >(
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      MiddlewareHandler<path, input6>,
      MiddlewareHandler<path, input7>,
      MiddlewareHandler<path, input8>,
      Handler<path, input9, response>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x8)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
    input7 extends Input = input & input2 & input3 & input4 & input5 & input6,
    input8 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      MiddlewareHandler<path, input6>,
      MiddlewareHandler<path, input7>,
      Handler<path, input8, response>,
    ]
  ): ApiRegistry;

  // app.get(handler x 10)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
    input7 extends Input = input & input2 & input3 & input4 & input5 & input6,
    input8 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7,
    input9 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7 &
      input8,
    input10 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7 &
      input8 &
      input9,
  >(
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      MiddlewareHandler<path, input6>,
      MiddlewareHandler<path, input7>,
      MiddlewareHandler<path, input8>,
      MiddlewareHandler<path, input9>,
      Handler<path, input10, response>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x9)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
    input7 extends Input = input & input2 & input3 & input4 & input5 & input6,
    input8 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7,
    input9 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7 &
      input8,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      MiddlewareHandler<path, input6>,
      MiddlewareHandler<path, input7>,
      MiddlewareHandler<path, input8>,
      Handler<path, input9, response>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x10)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
    input4 extends Input = input & input2 & input3,
    input5 extends Input = input & input2 & input3 & input4,
    input6 extends Input = input & input2 & input3 & input4 & input5,
    input7 extends Input = input & input2 & input3 & input4 & input5 & input6,
    input8 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7,
    input9 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7 &
      input8,
    input10 extends Input = input &
      input2 &
      input3 &
      input4 &
      input5 &
      input6 &
      input7 &
      input8 &
      input9,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<path, input>,
      MiddlewareHandler<path, input2>,
      MiddlewareHandler<path, input3>,
      MiddlewareHandler<path, input4>,
      MiddlewareHandler<path, input5>,
      MiddlewareHandler<path, input6>,
      MiddlewareHandler<path, input7>,
      MiddlewareHandler<path, input8>,
      MiddlewareHandler<path, input9>,
      Handler<path, input10, response>,
    ]
  ): ApiRegistry;

  // app.get(...handlers[])
  <
    path extends string = BasePath,
    input extends Input = BlankInput,
    response extends HandlerResponse<any> = any,
  >(
    ...handlers: Handler<path, input, response>[]
  ): ApiRegistry;

  // app.get(path, ...handlers[])
  <
    path extends string,
    input extends Input = BlankInput,
    response extends HandlerResponse<any> = any,
  >(
    path: path,
    ...handlers: Handler<path, input, response>[]
  ): ApiRegistry;

  // app.get(path)
  <path extends string>(path: path): ApiRegistry;
};

export interface MiddlewareHandlerInterface {
  //// app.use(...handlers[])
  (...handlers: MiddlewareHandler<BasePath>[]): ApiRegistry;

  // app.use(handler)
  (handler: MiddlewareHandler<BasePath>): ApiRegistry;

  // app.use(handler x2)
  <path extends string = BasePath>(
    ...handlers: [MiddlewareHandler<path>, MiddlewareHandler<path>]
  ): ApiRegistry;

  // app.get(path, handler)
  <path extends string>(
    path: path,
    handler: MiddlewareHandler<path>,
  ): ApiRegistry;

  // app.use(handler x3)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x2)
  <path extends string>(
    path: path,
    ...handlers: [MiddlewareHandler<path>, MiddlewareHandler<path>]
  ): ApiRegistry;

  // app.use(handler x4)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x3)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.use(handler x5)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x4)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.use(handler x6)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x5)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.use(handler x7)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x6)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.use(handler x8)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x7)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.use(handler x9)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x8)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.use(handler x10)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  // app.get(path, handler x9)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
      MiddlewareHandler<path>,
    ]
  ): ApiRegistry;

  //// app.use(path, ...handlers[])
  <path extends string>(
    path: path,
    ...handlers: MiddlewareHandler<path>[]
  ): ApiRegistry;
}
