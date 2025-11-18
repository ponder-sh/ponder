import "./App.css";
import { createClient } from "@ponder/client";
import { PonderProvider } from "@ponder/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Schema from "./components/schema";
import TableViewer from "./components/table-viewer";
import { getServerUrl } from "./lib/utils";

const queryClient = new QueryClient();
const client = createClient(`${getServerUrl()}/sql`);

function App() {
  return (
    <PonderProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <div className="grid grid-cols-[200px_1fr] min-h-screen">
          <aside className="p-4 border-r-1 border-brand-2">
            <img
              src="/ponder-light.svg"
              alt="Ponder Logo"
              className="h-6 self-start mb-4"
            />
            <Schema />
          </aside>
          <TableViewer />
        </div>
      </QueryClientProvider>
    </PonderProvider>
  );
}

export default App;
