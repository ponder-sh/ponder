"use client";

import type { Client } from "@ponder/client";
// biome-ignore lint/style/useImportType: "React" is needed
import React, { createContext } from "react";

export const PonderContext = createContext<Client | undefined>(undefined);

type PonderProviderProps = {
  client: Client;
};

export function PonderProvider(
  params: React.PropsWithChildren<PonderProviderProps>,
) {
  const { children, client } = params;

  return (
    <PonderContext.Provider value={client}>{children}</PonderContext.Provider>
  );
}
