import {
  HydrationBoundary,
  QueryClient,
  dehydrate,
} from "@tanstack/react-query";
import { depositsQueryOptions } from "../lib/ponder";
import DepositsTable from "../components/deposits-table";

export default async function App() {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery(depositsQueryOptions);

  return (
    <main
      className={
        "flex flex-col justify-between items-center pt-24 min-h-screen"
      }
    >
      <div className="flex flex-col gap-6 justify-center items-center p-4 w-full max-w-2xl">
        <h1 className="text-2xl font-bold">10 latest WETH mints</h1>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <DepositsTable />
        </HydrationBoundary>
      </div>
    </main>
  );
}
