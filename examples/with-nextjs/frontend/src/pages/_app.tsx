import "../styles/globals.css";

import { createClient } from "@ponder/client";
import { PonderProvider } from "@ponder/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AppProps } from "next/app";
import * as schema from "../../../ponder/ponder.schema";

const queryClient = new QueryClient();

const client = createClient("http://localhost:42069", { schema });

export { client, schema };

export default function App({ Component, pageProps }: AppProps) {
  return (
    <PonderProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <Component {...pageProps} />
      </QueryClientProvider>
    </PonderProvider>
  );
}
