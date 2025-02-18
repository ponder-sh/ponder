"use client";

import type { Client } from "@ponder/client";
import { createContext, createElement } from "react";

export const PonderContext = createContext<Client | undefined>(undefined);

type PonderProviderProps = {
  client: Client;
};

export function PonderProvider(
  parameters: React.PropsWithChildren<PonderProviderProps>,
) {
  const { children, client } = parameters;
  const props = { value: client };
  return createElement(PonderContext.Provider, props, children);
}
