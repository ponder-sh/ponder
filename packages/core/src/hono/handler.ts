import type { Schema } from "@/drizzle/index.js";
import type { ApiRegistry } from "@/types/api.js";
import type { BlankInput, HandlerResponse, Input, Next } from "hono/types";
import type { Context, MiddlewareContext } from "./context.js";

export type Handler<
  schema extends Schema = Schema,
  path extends string = any,
  input extends Input = BlankInput,
  response extends HandlerResponse<any> = any,
> = (c: Context<schema, path, input>) => response;

export type MiddlewareHandler<
  schema extends Schema = Schema,
  path extends string = string,
  input extends Input = {},
> = (
  c: MiddlewareContext<schema, path, input>,
  next: Next,
) => Promise<Response | void>;

type BasePath = "/";

export type HandlerInterface<schema extends Schema> = {
  // app.get(handler)
  <
    path extends string = BasePath,
    input extends Input = BlankInput,
    response extends HandlerResponse<any> = any,
  >(
    handler: Handler<schema, path, input, response>,
  ): ApiRegistry<schema>;

  // app.get(handler x2)
  <
    path extends string = BasePath,
    input extends Input = BlankInput,
    input2 extends Input = input,
    response extends HandlerResponse<any> = any,
  >(
    ...handlers: [
      Handler<schema, path, input>,
      Handler<schema, path, input2, response>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
  >(
    path: path,
    handler: Handler<schema, path, input, response>,
  ): ApiRegistry<schema>;

  // app.get(handler x 3)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
  >(
    ...handlers: [
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      Handler<schema, path, input3, response>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler x2)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
  >(
    path: path,
    ...handlers: [
      MiddlewareHandler<schema, path, input>,
      Handler<schema, path, input2, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      Handler<schema, path, input4, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      Handler<schema, path, input3, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      Handler<schema, path, input5, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      Handler<schema, path, input4, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      Handler<schema, path, input6, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      Handler<schema, path, input5, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      MiddlewareHandler<schema, path, input6>,
      Handler<schema, path, input7, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      Handler<schema, path, input6, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      MiddlewareHandler<schema, path, input6>,
      MiddlewareHandler<schema, path, input7>,
      Handler<schema, path, input8, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      MiddlewareHandler<schema, path, input6>,
      Handler<schema, path, input7, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      MiddlewareHandler<schema, path, input6>,
      MiddlewareHandler<schema, path, input7>,
      MiddlewareHandler<schema, path, input8>,
      Handler<schema, path, input9, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      MiddlewareHandler<schema, path, input6>,
      MiddlewareHandler<schema, path, input7>,
      Handler<schema, path, input8, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      MiddlewareHandler<schema, path, input6>,
      MiddlewareHandler<schema, path, input7>,
      MiddlewareHandler<schema, path, input8>,
      MiddlewareHandler<schema, path, input9>,
      Handler<schema, path, input10, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      MiddlewareHandler<schema, path, input6>,
      MiddlewareHandler<schema, path, input7>,
      MiddlewareHandler<schema, path, input8>,
      Handler<schema, path, input9, response>,
    ]
  ): ApiRegistry<schema>;

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
      MiddlewareHandler<schema, path, input>,
      MiddlewareHandler<schema, path, input2>,
      MiddlewareHandler<schema, path, input3>,
      MiddlewareHandler<schema, path, input4>,
      MiddlewareHandler<schema, path, input5>,
      MiddlewareHandler<schema, path, input6>,
      MiddlewareHandler<schema, path, input7>,
      MiddlewareHandler<schema, path, input8>,
      MiddlewareHandler<schema, path, input9>,
      Handler<schema, path, input10, response>,
    ]
  ): ApiRegistry<schema>;

  // app.get(...handlers[])
  <
    path extends string = BasePath,
    input extends Input = BlankInput,
    response extends HandlerResponse<any> = any,
  >(
    ...handlers: Handler<schema, path, input, response>[]
  ): ApiRegistry<schema>;

  // app.get(path, ...handlers[])
  <
    path extends string,
    input extends Input = BlankInput,
    response extends HandlerResponse<any> = any,
  >(
    path: path,
    ...handlers: Handler<schema, path, input, response>[]
  ): ApiRegistry<schema>;

  // app.get(path)
  <path extends string>(path: path): ApiRegistry<schema>;
};

export interface MiddlewareHandlerInterface<schema extends Schema> {
  //// app.use(...handlers[])
  (...handlers: MiddlewareHandler<schema, BasePath>[]): ApiRegistry<schema>;

  // app.use(handler)
  (handler: MiddlewareHandler<schema, BasePath>): ApiRegistry<schema>;

  // app.use(handler x2)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler)
  <path extends string>(
    path: path,
    handler: MiddlewareHandler<schema, path>,
  ): ApiRegistry<schema>;

  // app.use(handler x3)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler x2)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.use(handler x4)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler x3)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.use(handler x5)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler x4)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.use(handler x6)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler x5)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.use(handler x7)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler x6)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.use(handler x8)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler x7)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.use(handler x9)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler x8)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.use(handler x10)
  <path extends string = BasePath>(
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  // app.get(path, handler x9)
  <path extends string>(
    path: path,
    ...handlers: [
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
      MiddlewareHandler<schema, path>,
    ]
  ): ApiRegistry<schema>;

  //// app.use(path, ...handlers[])
  <path extends string>(
    path: path,
    ...handlers: MiddlewareHandler<schema, path>[]
  ): ApiRegistry<schema>;
}
