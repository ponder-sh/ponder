import { GraphQLClient } from "graphql-request";
import Link from "next/link";
import { cache } from "react";

import Table from "@/components/Table";
import { DepositsQueryDocument } from "@/graphql/generated/graphql";

export const revalidate = 1;

const client = new GraphQLClient("http://localhost:42069");

const getDeposits = cache(() =>
  client.request(DepositsQueryDocument).then((r) =>
    r.depositEvents.map((d) => ({
      id: d.id,
      timestamp: d.timestamp,
      account: d.account,
      amount: BigInt(d.amount),
    })),
  ),
);

export default async function App() {
  const deposits = await getDeposits();

  return (
    <main className={`flex flex-col items-center justify-between pt-24`}>
      <div className="w-full max-w-2xl flex flex-col p-4 gap-6">
        <h1 className="font-bold text-2xl">10 latest WETH mints</h1>

        <Link href="/pages" className="font-bold text-xl underline">
          Pages
        </Link>
        <Link href="/app" className="font-bold text-xl underline">
          App
        </Link>
        <div className="w-full flex gap-1 flex-col justify-between items-center">
          <Table deposits={deposits} />
        </div>
      </div>
    </main>
  );
}
