import pkg from "../../../packages/core/package.json";

export const versions = [
  {
    key: "latest",
    label: "Latest Version",
    patch: pkg.version,
    prefix: "/docs",
    isLatest: true,
  },
  {
    key: "0.17",
    label: "Versions 0.16 - 0.17",
    patch: "0.17.12, 0.16.10",
    prefix: "/docs/0.17",
    isLatest: false,
  },
  {
    key: "0.15",
    label: "Version 0.15",
    patch: "0.15.18",
    prefix: "/docs/0.15",
    isLatest: false,
  },
  {
    key: "0.14",
    label: "Version 0.14",
    patch: "0.14.13",
    prefix: "/docs/0.14",
    isLatest: false,
  },
  {
    key: "0.12",
    label: "Versions 0.12 - 0.13",
    patch: "0.13.13, 0.12.26",
    prefix: "/docs/0.12",
    isLatest: false,
  },
  {
    key: "0.11",
    label: "Version 0.11",
    patch: "0.11.43",
    prefix: "/docs/0.11",
    isLatest: false,
  },
  {
    key: "0.10",
    label: "Version 0.10",
    patch: "0.10.26",
    prefix: "/docs/0.10",
    isLatest: false,
  },
] as const;

export type Version = (typeof versions)[number];

const versionsByPrefixLength = [...versions].sort(
  (a, b) => b.prefix.length - a.prefix.length,
);

/** Returns the docs version that contains `path`, if any. */
export function getActiveVersion(path: string): Version | undefined {
  return versionsByPrefixLength.find(
    (v) => path === v.prefix || path.startsWith(`${v.prefix}/`),
  );
}
