import type { Prettify } from "@/types/utils.js";

export const extend = <
  TCreate extends (...params: any[]) => any,
  TMethods extends { [methodName: string]: (...params: any[]) => unknown },
>(
  create: TCreate,
  _methods: TMethods,
): ((
  ...params: Parameters<TCreate>
) => ReturnType<TCreate> extends Promise<any>
  ? Promise<Extend<Awaited<ReturnType<TCreate>>, TMethods>>
  : Extend<ReturnType<TCreate>, TMethods>) => {
  return (...params: Parameters<TCreate>) => {
    const service = create(...params);

    if (service instanceof Promise) {
      return service.then((s) => {
        const methods: any = {};
        for (const [methodName, method] of Object.entries(_methods)) {
          methods[methodName] = (...params: any) => method(s, ...params);
        }

        return {
          ...s,
          ...methods,
        };
      });
    } else {
      const methods: any = {};
      for (const [methodName, method] of Object.entries(_methods)) {
        methods[methodName] = (...params: any) => method(service, ...params);
      }

      return {
        ...service,
        ...methods,
      };
    }
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
