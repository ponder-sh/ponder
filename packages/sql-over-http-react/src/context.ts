"use client";

import type { Client } from "@ponder/client";
import { createContext, createElement } from "react";
import type { ResolvedSchema } from "./index.js";

export const PonderContext = createContext<Client<ResolvedSchema> | undefined>(
  undefined,
);

type PonderProviderProps = {
  client: Client<ResolvedSchema>;
};

export function PonderProvider(
  parameters: React.PropsWithChildren<PonderProviderProps>,
) {
  const { children, client } = parameters;
  const props = { value: client };
  return createElement(PonderContext.Provider, props, children);
}
