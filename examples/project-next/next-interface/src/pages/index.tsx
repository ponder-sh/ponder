import { Inter } from "next/font/google";

import Table from "@/components/Table";
import { useTransfers } from "@/hooks/useTransfers";

const inter = Inter({ subsets: ["latin"] });

export default function Home() {
  const transfers = useTransfers();

  return (
    <main
      className={`flex min-h-screen flex-col items-center justify-between pt-24 ${inter.className}`}
    >
      <div className="w-full max-w-2xl flex flex-col p-4 gap-12 items-center">
        <h1 className="font-bold text-2xl">10 latest WETH transfers</h1>
        <div className="w-full flex gap-1 flex-col justify-between items-center">
          {transfers.status === "pending" ? (
            <p className="font-semibold">Loading...</p>
          ) : transfers.status === "error" ? (
            <p className="font-semibold text-red-500">
              Error fetching transfers
            </p>
          ) : (
            <Table transfers={transfers.data} />
          )}
        </div>
      </div>
    </main>
  );
}
