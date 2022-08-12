import { useEffect } from "react";
import createStore from "zustand";
import { persist } from "zustand/middleware";

import { cachedFetch } from "./cachedFetch";

type State = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolvedAddresses: Partial<Record<string, any>>;
};

export const useStore = createStore<State>(
  persist(() => ({ resolvedAddresses: {} }), { name: "resolved-ens" })
);

export const useENS = (address: string) => {
  const addressLowercase = address.toLowerCase();
  const resolved = useStore(
    (state) => state.resolvedAddresses[addressLowercase]
  );

  useEffect(() => {
    (async () => {
      try {
        const data = await cachedFetch(
          `https://api.ensideas.com/ens/resolve/${addressLowercase}`
        ).then((res) => res.json());
        useStore.setState((state) => ({
          resolvedAddresses: {
            ...state.resolvedAddresses,
            [addressLowercase]: data,
          },
        }));
      } catch (error) {
        console.log("could not resolve ens", error);
      }
    })();
  }, [addressLowercase]);

  return {
    address: resolved?.address,
    name: resolved?.name,
    displayName: resolved?.displayName,
    avatar: resolved?.avatar,
  };
};
