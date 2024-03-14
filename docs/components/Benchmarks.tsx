import Link from "next/link";
import * as React from "react";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import GraphLogo from "../public/graph.svg";

const Benchmarks = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { flat?: boolean }
>(({ className, flat = false, ...props }, ref) => {
  return (
    <Card
      ref={ref}
      className={cn([
        "w-full flex flex-col justify-between md:flex-row gap-8 mb-8",
        flat ? "rounded-none md:rounded-lg" : "",
        className,
      ])}
      {...props}
    >
      <div className="flex flex-col lg:flex-row w-full">
        <div className="flex flex-col flex-grow lg:border-r border-neutral-200 dark:border-neutral-50/20">
          <div className="flex flex-col px-4 md:px-8 pt-6 md:pt-8">
            <CardTitle className="mb-6">Benchmarks</CardTitle>
            <div className="flex flex-row justify-start mb-3 gap-3 w-full">
              <div className="h-[33px] w-[calc((100%-75px)*0.0925)] bg-ponder rounded-[4px]" />
              <p className="pt-[2px]">37s</p>
            </div>
            <div className="flex flex-row justify-start mb-5 gap-3 w-full">
              <div className="h-[34px] w-[calc(100%-75px)] bg-neutral-400 dark:bg-neutral-700 rounded-[4px] flex items-center">
                <GraphLogo className="ml-[10px]" />
              </div>
              <p className="pt-[2px]">6m 40s</p>
            </div>
          </div>

          <div className="grid grid-cols-4 md:grid-cols-5">
            <div className="col-span-1 py-2 pl-4 md:pl-8 text-sm border-neutral-200 dark:border-neutral-50/20 border-b text-neutral-500"></div>
            <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
              Sync (Cold)
            </div>
            <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
              Sync (Cache)
            </div>
            <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b hidden md:block">
              Database Size
            </div>
            <div className="col-span-1 py-2 pl-3 text-sm border-neutral-200 dark:border-neutral-50/20 border-b">
              RPC Credits
            </div>

            <div className="col-span-1 py-2 pl-4 md:pl-8 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder bg-ponder/10">
              Ponder
            </div>
            <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder bg-ponder/10">
              37s
            </div>
            <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder bg-ponder/10">
              5s
            </div>
            <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b border-r text-ponder bg-ponder/10 hidden md:block">
              31 MB
            </div>
            <div className="col-span-1 py-2 pl-3 border-neutral-200 dark:border-neutral-50/20 border-b text-ponder bg-ponder/10">
              108k
            </div>

            <div className="col-span-1 py-2 pl-4 pb-3 lg:pb-6 md:pl-8 border-neutral-200 dark:border-neutral-50/20 border-r max-lg:border-b">
              The Graph
            </div>
            <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 border-r max-lg:border-b">
              5m 28s
            </div>
            <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 border-r max-lg:border-b">
              1m 15s
            </div>
            <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 border-r max-lg:border-b hidden md:block">
              1.1 GB
            </div>
            <div className="col-span-1 py-2 pl-3 pb-3 lg:pb-6 border-neutral-200 dark:border-neutral-50/20 max-lg:border-b">
              167k
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:max-w-[22ch] p-4 md:p-6">
          <p className="text-sm mb-4 text-neutral-700 dark:text-neutral-200">
            Results of indexing the Rocket Pool ERC20 token contract on mainnet
            from block 18,600,000 to 18,718,056 (latest) on an M1 MacBook Pro (8
            core, 16GB RAM) against an Alchemy node on the Growth plan using a
            950MB/s network connection.
          </p>
          <Link
            href="https://github.com/ponder-sh/ponder/tree/main/benchmarks#readme"
            target="_blank"
            className="text-sm text-ponder hover:text-ponder-50/90"
          >
            Run it yourself →
          </Link>
        </div>
      </div>
    </Card>
  );
});
Benchmarks.displayName = "Benchmarks";

export { Benchmarks };
