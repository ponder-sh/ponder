"use client";

import { Callout, Link, useRouter } from "vocs";
import { getCanonicalSubpath } from "../sidebar";
import { getActiveVersion } from "./versions";

/**
 * Warns readers of versioned docs pages and links to the latest version of
 * the page.
 */
export function OutdatedVersion() {
  const { path } = useRouter();
  const activeVersion = getActiveVersion(path);

  if (activeVersion === undefined || activeVersion.isLatest) return null;

  const latestHref = getCanonicalSubpath(path);

  return (
    <Callout variant="warning">
      <p>
        You are viewing the documentation for an outdated version of Ponder.
        {latestHref !== null && (
          <>
            {" "}
            Visit the <Link to={latestHref}>latest version</Link> of this page.
          </>
        )}
      </p>
    </Callout>
  );
}
