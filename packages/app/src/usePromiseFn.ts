import {
  DependencyList,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type PromiseState<TValue> =
  | { type: "idle"; value: TValue | undefined }
  | { type: "pending"; value: TValue | undefined }
  | { type: "fulfilled"; value: TValue }
  | { type: "rejected"; error: unknown };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AsyncFunction = (...args: any[]) => PromiseLike<any>;

export const usePromiseFn = <TFunc extends AsyncFunction>(
  promiseFn: TFunc,
  deps: DependencyList = []
): [
  PromiseState<Awaited<ReturnType<TFunc>>>,
  (...args: Parameters<TFunc>) => ReturnType<TFunc>
] => {
  const mounted = useRef(false);
  const lastPromiseId = useRef(0);
  const [state, setState] = useState<PromiseState<Awaited<ReturnType<TFunc>>>>({
    type: "idle",
    value: undefined,
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const currentValue = state.type === "rejected" ? undefined : state.value;

  const mutate = useCallback(
    (...args: Parameters<TFunc>) => {
      if (!mounted.current) {
        throw new Error(
          "usePromiseFn: tried to call promise fn while not mounted"
        );
      }

      setState({
        type: "pending",
        value: currentValue,
      });
      const promiseId = ++lastPromiseId.current;
      const promise = promiseFn(...args) as ReturnType<TFunc>;
      promise.then(
        (value) =>
          mounted.current &&
          promiseId === lastPromiseId.current &&
          setState({ type: "fulfilled", value }),
        (error) =>
          mounted.current &&
          promiseId === lastPromiseId.current &&
          setState({ type: "rejected", error })
      );
      return promise;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps, currentValue]
  );

  return [state, mutate];
};
