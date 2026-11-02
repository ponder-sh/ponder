"use client";

import { useConfig, useRouter } from "vocs";
import { getCanonicalSubpath } from "../sidebar";
import { getActiveVersion } from "./versions";

/**
 * Canonical link for every page. Versioned docs pages point to the latest
 * version of the page, or omit the link if there is no latest version.
 */
export function Canonical() {
  const { path } = useRouter();
  const { baseUrl } = useConfig();
  const version = getActiveVersion(path);
  const href = version && !version.isLatest ? getCanonicalSubpath(path) : path;

  if (!baseUrl || href === null) return null;
  return <link rel="canonical" href={`${baseUrl}${href}`} />;
}
