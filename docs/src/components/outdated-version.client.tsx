"use client";

import { Callout, Link, useConfig, useRouter } from "vocs";
import { getCanonicalSubpath } from "../sidebar";
import { getActiveVersion } from "./versions";

/**
 * Warns readers of versioned docs pages, links to the latest version of the
 * page, and marks that page as canonical.
 */
export function OutdatedVersion() {
  const { path } = useRouter();
  const { baseUrl } = useConfig();
  const activeVersion = getActiveVersion(path);

  if (activeVersion === undefined || activeVersion.isLatest) return null;

  const latestHref = getCanonicalSubpath(path);

  return (
    <>
      {latestHref !== null && baseUrl && (
        <link rel="canonical" href={`${baseUrl}${latestHref}`} />
      )}
      <Callout variant="warning">
        <p>
          You are viewing the documentation for an outdated version of Ponder.
          {latestHref !== null && (
            <>
              {" "}
              Visit the <Link to={latestHref}>latest version</Link> of this
              page.
            </>
          )}
        </p>
      </Callout>
    </>
  );
}
