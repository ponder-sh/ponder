"use client";

import { PonderProvider } from "@ponder/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { client } from "../lib/ponder";

export function Providers(props: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <PonderProvider client={client}>
      <QueryClientProvider client={queryClient}>
        {props.children}
      </QueryClientProvider>
    </PonderProvider>
  );
}
