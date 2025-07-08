"use client";

import { usePonderQuery } from "@ponder/react";
import { useState } from "react";
import CountUp from "react-countup";
import { formatEther } from "viem";
import { infiniteDepositsQueryOptions } from "../lib/ponder";

const PAGE_SIZE = 20;

type Deposit = {
  id: string;
  account: string;
  amount: bigint;
  timestamp: number;
};

export default function DepositsTable() {
  const [page, setPage] = useState(0);
  const depositsQuery = usePonderQuery(
    infiniteDepositsQueryOptions(PAGE_SIZE, page),
  );

  const isFirstPage = page === 0;
  const isLastPage =
    depositsQuery.data && (depositsQuery.data as Deposit[]).length < PAGE_SIZE;

  const deposits = (depositsQuery.data ?? []) as Deposit[];

  return (
    <div className="flex flex-col gap-4 justify-between items-center w-full">
      {depositsQuery.status === "pending" ? (
        <p className="font-semibold">Loading...</p>
      ) : depositsQuery.status === "error" ? (
        <p className="font-semibold text-red-500">Error fetching mints</p>
      ) : (
        <>
          <ul className="w-full">
            <li className="grid grid-cols-2 w-full text-lg font-semibold sm:grid-cols-3">
              <p>Account</p>
              <p>Amount</p>
              <p className="hidden sm:flex">Timestamp</p>
            </li>
            {deposits.map(({ account, timestamp, amount, id }) => (
              <li
                className="grid grid-cols-2 py-2 w-full text-lg font-semibold sm:grid-cols-3"
                key={id}
              >
                <a
                  className="text-sm font-semibold text-red-500 underline"
                  href={`https://etherscan.io/address/${account}`}
                >
                  {account.slice(0, 6)}...{account.slice(38)}
                </a>
                <CountUp
                  start={0}
                  end={Number(formatEther(amount))}
                  duration={2.5}
                  decimals={5}
                  decimal={"."}
                  separator={","}
                  className="text-sm font-semibold"
                />
                <p className="hidden text-sm sm:flex">
                  {new Date(timestamp * 1000).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
          <div className="flex flex-row gap-4 items-center mt-2">
            <button
              type="button"
              className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={isFirstPage}
            >
              Previous
            </button>
            <span className="text-sm">Page {page + 1}</span>
            <button
              type="button"
              className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
              onClick={() =>
                setPage((p) => (deposits.length < PAGE_SIZE ? p : p + 1))
              }
              disabled={isLastPage}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}
