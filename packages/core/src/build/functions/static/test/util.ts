import type { SgNode } from "@ast-grep/napi";
import type { Context, Event } from "./ponder-env.d.ts";

export const helper1 = async ({
  context,
}: {
  context: Context;
  junk?: string;
}) => {
  await context.db.Table1.upsert({
    id: "helper1",
  });
};

export async function helper2(context: Context) {
  await context.db.Table1.upsert({
    id: "helper2",
  });
}

export async function helper3({ context }: { event: Event; context: Context }) {
  await context.db.Table1.upsert({
    id: "helper3",
  });
}

export class HelperClass {
  async helperC({ context }: { event: Event; context: Context }) {
    await context.db.Table1.upsert({
      id: "helperClass",
    });
  }
}

export const HelperObject = {
  helperO: async ({ context }: { event: Event; context: Context }) => {
    await context.db.Table1.upsert({
      id: "helperObject",
    });
  },
};

export const printNodes = (nodes: SgNode[]) => {
  for (const node of nodes) {
    console.log(node.text());
  }
};
