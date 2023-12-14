import { Slot } from "@radix-ui/react-slot";
import Link from "next/link";

import { Benchmarks } from "@/components/Benchmarks";
import { buttonDefaults } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

import GraphLogo from "../public/graph.svg";
import {
  CommandLineIcon,
  CursorArrowRaysIcon,
  ServerStackIcon,
  ShieldCheckIcon,
} from "./icons";

export function Home() {
  return (
    <main className="w-full max-w-full relative">
      <div className="max-w-[1180px] mx-auto px-6 mt-4 md:mt-16">
        <div className="w-full flex flex-col justify-between md:flex-row gap-8 p-4 mb-6 md:p-8 rounded-lg text-neutral-950 shadow-sm dark:text-neutral-50 hero-texture">
          <div className="flex flex-col items-start space-y-1.5 max-w-[540px]">
            <p className="pb-4 text-neutral-500 dark:text-neutral-400">
              Introducing Ponder
            </p>
            <h1 className="text-4xl font-semibold tracking-tight pb-4">
              Rapidly build an API for any EVM smart contract
            </h1>
            <p>
              Ponder is an open-source backend framework for building robust,
              performant, and maintainable crypto apps
            </p>
          </div>

          <div className="flex flex-row justify-center items-end w-full md:w-[unset]">
            <div className="w-full md:w-[unset] space-y-4">
              <div className="flex flex-row gap-4">
                <Slot
                  className={cn([
                    buttonDefaults,
                    "h-10 px-4 py-2",
                    "flex-grow md:px-10 text-neutral-50 bg-ponder hover:bg-ponder-200/90",
                  ])}
                >
                  <Link href="/docs/getting-started">Get started</Link>
                </Slot>
                <Slot
                  className={cn([
                    buttonDefaults,
                    "h-10 px-4 py-2",
                    "text-neutral-900 dark:text-neutral-50 bg-white bg-opacity-20 hover:bg-opacity-30",
                  ])}
                >
                  <Link href="/blog/introducing-ponder">Why Ponder?</Link>
                </Slot>
              </div>
              <div className="flex flex-row justify-center">
                <Slot
                  className={cn([
                    buttonDefaults,
                    "h-10 px-4 py-2",
                    "flex-grow border text-neutral-900 dark:text-neutral-50 border-neutral-200/30 hover:bg-neutral-100/30",
                  ])}
                >
                  <Link
                    href="https://github.com/0xOlias/ponder"
                    target="_blank"
                  >
                    View on GitHub
                  </Link>
                </Slot>
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-between flex-wrap gap-y-4 mb-6">
          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start p-4 md:p-8">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-200 dark:bg-neutral-800">
                <ServerStackIcon />
              </div>
              <CardTitle>Powerful local dev server</CardTitle>
              <CardDescription>
                Build incredibly fast & stay unblocked with{" "}
                <strong>hot reloading</strong>
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start p-4 md:p-8">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-200 dark:bg-neutral-800">
                <ShieldCheckIcon />
              </div>
              <CardTitle>Fast & lean</CardTitle>
              <CardDescription>
                Sync <strong>~10x faster</strong> than Graph Protocol subgraphs
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start p-4 md:p-8">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-200 dark:bg-neutral-800">
                <CommandLineIcon />
              </div>
              <CardTitle>Type safe</CardTitle>
              <CardDescription>
                End-to-end type safety & autocomplete with{" "}
                <strong>no codegen</strong>
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start p-4 md:p-8">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-200 dark:bg-neutral-800">
                <CursorArrowRaysIcon />
              </div>
              <CardTitle>One-click deploys</CardTitle>
              <CardDescription>
                Deploy anywhere that runs Node.js with{" "}
                <strong>zero downtime</strong> &{" "}
                <strong>horizontal scaling</strong>
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Benchmarks />
      </div>
    </main>
  );
}
