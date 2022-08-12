import { useEffect, useState } from "react";

type PromiseState<TValue, TError> =
  | { type: "pending"; value: TValue | undefined }
  | { type: "fulfilled"; value: TValue }
  | { type: "rejected"; error: TError };

export const usePromise = <TValue, TError = unknown>(
  promise: PromiseLike<TValue>,
  initialValue?: TValue
) => {
  const [state, setState] = useState<PromiseState<TValue, TError>>({
    type: "pending",
    value: initialValue,
  });

  useEffect(() => {
    let mounted = true;

    promise.then(
      (value) => mounted && setState({ type: "fulfilled", value }),
      (error) => mounted && setState({ type: "rejected", error })
    );

    return () => {
      mounted = false;
    };
  }, [promise]);

  return state;
};
