import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The modules the sync engine is entered through.
 *
 * Anything reachable from here is part of the engine, and is what a standalone
 * consumer would have to install.
 */
const ENTRYPOINTS = [
  "sync-historical/index.ts",
  "sync-realtime/index.ts",
  "rpc/index.ts",
];

/**
 * Layers the sync engine must not reach.
 *
 * The engine talks to storage through the `SyncStore` type in
 * `sync-store/store.ts` and nothing else, so an application can supply its own
 * implementation over its own tables. Reaching any of these would put a
 * database driver, an HTTP server, or the CLI back in its import graph -- and
 * `bin/ponder.ts` in particular runs a command when it is imported.
 */
const FORBIDDEN = [
  "bin/",
  "build/",
  "client/",
  "database/",
  "drizzle/",
  "graphql/",
  "indexing/",
  "indexing-store/",
  "server/",
  "sync-store/index.ts",
];

/** Packages that would come with a database or a web server. */
const FORBIDDEN_PACKAGES = [
  "drizzle-orm",
  "drizzle-kit",
  "pg",
  "pg-connection-string",
  "@electric-sql/pglite",
  "hono",
  "@hono/node-server",
  "@commander-js/extra-typings",
  "graphql",
];

const SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+"([^"]+)"/g;

function specifiers(file: string): string[] {
  const source = readFileSync(join(SRC, file), "utf8");
  return [...source.matchAll(SPECIFIER)].map((m) => m[1]!);
}

function resolveSpecifier(from: string, specifier: string): string | undefined {
  if (specifier.startsWith("@/")) {
    return `${specifier.slice(2).replace(/\.js$/, ".ts")}`;
  }
  if (specifier.startsWith(".")) {
    const abs = resolve(dirname(join(SRC, from)), specifier);
    return relative(SRC, abs).replace(/\.js$/, ".ts");
  }
  return undefined;
}

/** Every source file reachable from the sync engine's entrypoints. */
function closure(): { files: Set<string>; packages: Map<string, string[]> } {
  const files = new Set<string>();
  const packages = new Map<string, string[]>();
  const stack = [...ENTRYPOINTS];

  while (stack.length > 0) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    let found: string[];
    try {
      found = specifiers(file);
    } catch {
      continue; // not a file in this package
    }
    files.add(file);

    for (const specifier of found) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved === undefined) {
        const pkg = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0]!;
        packages.set(pkg, [...(packages.get(pkg) ?? []), file]);
        continue;
      }
      stack.push(resolved);
    }
  }

  return { files, packages };
}

test("the sync engine does not import the database, server, or CLI layers", () => {
  const { files } = closure();

  const violations = [...files]
    .filter((file) => FORBIDDEN.some((layer) => file.startsWith(layer)))
    .sort();

  expect(violations).toStrictEqual([]);
});

test("the sync engine does not depend on a database driver or web server", () => {
  const { packages } = closure();

  const violations = FORBIDDEN_PACKAGES.filter((pkg) => packages.has(pkg))
    .map((pkg) => `${pkg} (via ${packages.get(pkg)!.join(", ")})`)
    .sort();

  expect(violations).toStrictEqual([]);
});

test("the sync engine reaches storage only through the SyncStore contract", () => {
  const { files } = closure();

  // The contract is in the closure; the Drizzle implementation beside it is not.
  expect(files.has("sync-store/store.ts")).toBe(true);
  expect(files.has("sync-store/index.ts")).toBe(false);
});
