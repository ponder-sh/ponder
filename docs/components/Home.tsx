import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  CommandLineIcon,
  CursorArrowRaysIcon,
  ServerStackIcon,
  ShieldCheckIcon,
} from "./icons";

export function Home() {
  return (
    <main className="w-full max-w-full relative">
      <div className="max-w-[1120px] mx-auto px-6 mt-8">
        <Card className="w-full flex flex-col justify-between md:flex-row gap-8 p-4 mb-4 md:p-8 md:mb-8">
          <div className="flex flex-col items-start space-y-1.5 max-w-[540px]">
            <p className="pb-4 text-neutral-500 dark:text-neutral-400">
              Introducing Ponder
            </p>
            <h1 className="text-4xl font-semibold tracking-tight pb-4">
              Rapidly build an API for any EVM smart contract
            </h1>
            <p>
              Ponder is an open-source framework that makes it easy to build
              robust, performant, and maintainable web backends for crypto apps.
            </p>
          </div>

          <div className="flex flex-row justify-center items-end w-full md:w-[unset]">
            <div className="w-full md:w-[unset] space-y-4">
              <div className="flex flex-row gap-4">
                <Button className="flex-grow md:px-10">Get started</Button>
                <Button variant="secondary" className="flex-grow">
                  Why Ponder?
                </Button>
              </div>
              <div className="flex flex-row justify-center">
                <Button
                  variant="outline"
                  className="flex-grow bg-transparent dark:bg-transparent"
                >
                  View on GitHub
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <div className="flex justify-between flex-wrap gap-y-4">
          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-100 dark:bg-neutral-800">
                <ServerStackIcon />
              </div>
              <CardTitle>Local dev server</CardTitle>
              <CardDescription>
                Get instant feedback with hot reloading
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-100 dark:bg-neutral-800">
                <ShieldCheckIcon />
              </div>
              <CardTitle>Built for app developers</CardTitle>
              <CardDescription>
                Install NPM libs and make network requests
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-100 dark:bg-neutral-800">
                <CommandLineIcon />
              </div>
              <CardTitle>Type safe</CardTitle>
              <CardDescription>
                End-to-end type safety & autocomplete, no codegen required
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="w-[calc(25%-12px)] max-lg:w-[calc(50%-8px)] max-sm:w-full">
            <CardHeader className="items-start">
              <div className="p-2 rounded-[4px] mb-5 bg-neutral-100 dark:bg-neutral-800">
                <CursorArrowRaysIcon />
              </div>
              <CardTitle>One-click deploys</CardTitle>
              <CardDescription>
                Deploy anywhere that runs Node.js, with zero downtime
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <div className="flex flex-row justify-between pt-12 max-sm:pt-0">
          <div className="max-w-[400px] flex flex-col items-start space-y-8">
            <Button>Muahahaha</Button>

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ponder-white.svg" className="h-12" alt="Ponder logo" />
            <p className="font-medium text-[20px]">
              A backend framework for crypto apps
            </p>
            <div className="flex flex-row justify-start space-x-4">
              <a
                className="px-5 leading-9 rounded-full bg-ponder-400 border border-ponder-800 hover:bg-ponder-800"
                href="/getting-started/new-project"
              >
                Get started
              </a>
              <a
                className="px-5 leading-9 bg-red-700 rounded-full"
                href="/why-ponder"
              >
                Why Ponder?
              </a>
            </div>
          </div>
          <div className="flex flex-col space-y-8">CODE BLOCK</div>
        </div>
        <div className="flex flex-row justify-between pt-12 max-sm:pt-0"></div>
      </div>
    </main>
  );
}
