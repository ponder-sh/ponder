"use client";

import { Callout, Link, useRouter } from "vocs";
import { getCanonicalSubpath, getVersion } from "../versions";

/**
 * Warns readers when they are viewing an archived version of the docs, and
 * links to the equivalent page in the latest version.
 *
 * The matching `<link rel="canonical">` is emitted by `head` in
 * `vocs.config.ts`; this is presentational only. Note that it is React chrome
 * outside the MDX AST, so it does not reach the generated `.md` twins or
 * `llms-full.txt` — serving the same warning to agents is tracked separately.
 */
export function OutdatedVersionCallout() {
  const { path } = useRouter();
  const version = getVersion(path);

  if (version === undefined || version.isLatest) return null;

  const canonical = getCanonicalSubpath(path);

  return (
    <Callout variant="warning">
      You are viewing the documentation for an outdated version of Ponder.
      {canonical !== null ? (
        <>
          {" "}
          Visit the <Link to={canonical}>latest version</Link> of this page.
        </>
      ) : null}
    </Callout>
  );
}
