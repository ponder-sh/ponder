/**
 * The canonical production origin.
 *
 * `head` in `vocs.config.ts` inlines this literal because Vocs serializes
 * config functions and re-evaluates them in a bare scope, so that callback
 * cannot import it. `scripts/verify-versions.ts` asserts the two agree.
 */
export const productionUrl = "https://ponder.sh";

/**
 * The site's absolute base URL. Shared by `vocs.config.ts` and any component
 * that needs to emit absolute URLs.
 */
export const baseUrl =
  process.env.VERCEL_ENV === "production"
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5173";
