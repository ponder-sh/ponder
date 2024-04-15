import type { Prettify } from "@/types/utils.js";

export const extend = <
  TCreate extends (...params: any[]) => Promise<any>,
  TMethods extends { [methodName: string]: (...params: any[]) => unknown },
>(
  create: TCreate,
  _methods: TMethods,
): ((
  ...params: Parameters<TCreate>
) => Promise<Extend<Awaited<ReturnType<TCreate>>, TMethods>>) => {
  return async (...params: Parameters<TCreate>) => {
    // TODO(kyle) handle async
    const service = await create(...params);

    const methods: any = {};
    for (const [methodName, method] of Object.entries(_methods)) {
      methods[methodName] = (...params: any) => method(service, ...params);
    }

    return {
      ...service,
      ...methods,
    };
  };
};

export type Extend<
  service,
  methods extends { [methodName: string]: (...params: any[]) => unknown },
> = Prettify<
  service & {
    [methodName in keyof methods]: Parameters<methods[methodName]> extends [
      any,
      ...infer parameters,
    ]
      ? (...params: parameters) => ReturnType<methods[methodName]>
      : never;
  }
>;
