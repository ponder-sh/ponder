"use client";

import { usePonderQuery } from "@ponder/react";
import CountUp from "react-countup";
import { formatEther } from "viem";
import { depositsQueryOptions } from "../lib/ponder";

export default function DepositsTable() {
  const depositsQuery = usePonderQuery(depositsQueryOptions);

  return (
    <div className="flex flex-col gap-1 justify-between items-center w-full">
      {depositsQuery.status === "pending" ? (
        <p className="font-semibold">Loading...</p>
      ) : depositsQuery.status === "error" ? (
        <p className="font-semibold text-red-500">Error fetching mints</p>
      ) : (
        <ul className="w-full">
          <li className="grid grid-cols-2 w-full text-lg font-semibold sm:grid-cols-3">
            <p>Account</p>
            <p>Amount</p>
            <p className="hidden sm:flex">Timestamp</p>
          </li>
          {depositsQuery.data?.map(({ account, timestamp, amount, id }) => (
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
      )}
    </div>
  );
}
