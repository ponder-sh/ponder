import type { Hono } from "hono";
import type {
  BlankInput,
  BlankSchema,
  Env,
  HandlerResponse,
  Input,
  Next,
} from "hono/types";
import type { Context } from "./context.js";

export type Handler<
  path extends string = any,
  input extends Input = BlankInput,
  response extends HandlerResponse<any> = any,
> = (c: Context<path, input>) => response;

export type MiddlewareHandler<
  path extends string = string,
  input extends Input = {},
> = (c: Context<path, input>, next: Next) => Promise<Response | void>;

export type H<
  path extends string = any,
  input extends Input = BlankInput,
  response extends HandlerResponse<any> = any,
> = Handler<path, input, response> | MiddlewareHandler<path, input>;

type BasePath = "/";

export type HandlerInterface = {
  // app.get(handler)
  <
    path extends string = BasePath,
    input extends Input = BlankInput,
    response extends HandlerResponse<any> = any,
  >(
    handler: Handler<path, input, response>,
  ): Hono<Env, BlankSchema>;

  // app.get(handler x2)
  <
    path extends string = BasePath,
    input extends Input = BlankInput,
    input2 extends Input = input,
    response extends HandlerResponse<any> = any,
  >(
    ...handlers: [Handler<path, input>, Handler<path, input2, response>]
  ): Hono<Env, BlankSchema>;

  // app.get(path, handler)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
  >(
    path: path,
    handler: Handler<path, input, response>,
  ): Hono<Env, BlankSchema>;

  // app.get(handler x 3)
  <
    path extends string = BasePath,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
    input3 extends Input = input & input2,
  >(
    ...handlers: [
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3, response>,
    ]
  ): Hono<Env, BlankSchema>;

  // app.get(path, handler x2)
  <
    path extends string,
    response extends HandlerResponse<any> = any,
    input extends Input = BlankInput,
    input2 extends Input = input,
  >(
    path: path,
    ...handlers: [Handler<path, input>, Handler<path, input2, response>]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6>,
      Handler<path, input7, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6>,
      Handler<path, input7>,
      Handler<path, input8, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6>,
      Handler<path, input7, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6>,
      Handler<path, input7>,
      Handler<path, input8>,
      Handler<path, input9, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6>,
      Handler<path, input7>,
      Handler<path, input8, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6>,
      Handler<path, input7>,
      Handler<path, input8>,
      Handler<path, input9>,
      Handler<path, input10, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6>,
      Handler<path, input7>,
      Handler<path, input8>,
      Handler<path, input9, response>,
    ]
  ): Hono<Env, BlankSchema>;

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
      Handler<path, input>,
      Handler<path, input2>,
      Handler<path, input3>,
      Handler<path, input4>,
      Handler<path, input5>,
      Handler<path, input6>,
      Handler<path, input7>,
      Handler<path, input8>,
      Handler<path, input9>,
      Handler<path, input10, response>,
    ]
  ): Hono<Env, BlankSchema>;

  // app.get(...handlers[])
  <
    path extends string = BasePath,
    input extends Input = BlankInput,
    response extends HandlerResponse<any> = any,
  >(
    ...handlers: Handler<path, input, response>[]
  ): Hono<Env, BlankSchema>;

  // app.get(path, ...handlers[])
  <
    path extends string,
    input extends Input = BlankInput,
    response extends HandlerResponse<any> = any,
  >(
    path: path,
    ...handlers: Handler<path, input, response>[]
  ): Hono<Env, BlankSchema>;

  // app.get(path)
  <path extends string>(path: path): Hono<Env, BlankSchema>;
};
