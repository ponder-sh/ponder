import { defineConfig, McpSource } from "vocs/config";
import { baseUrl } from "./base-url.ts";
import { redirects } from "./redirects.ts";
import { sidebar } from "./sidebar.ts";

export default defineConfig({
  title: "Ponder",
  titleTemplate: "%s – Ponder",
  description:
    "Ponder is an open-source TypeScript framework for EVM data indexing.",
  rootDir: ".",
  // Pages live at `docs/pages`, not the v2 default of `docs/src/pages`.
  srcDir: ".",
  baseUrl,
  iconUrl: { light: "/icon.png", dark: "/icon.png" },
  logoUrl: { light: "/ponder-light.svg", dark: "/ponder-dark.svg" },
  ogImageUrl: `${baseUrl}/api/og?title=%title&description=%description`,
  accentColor: "light-dark(#0a9fb2, #10c2d5)",
  colorScheme: "light dark",
  // Static pages, with serverless functions for `/api/og` and `/api/mcp`.
  renderStrategy: "partial-static",
  redirects,
  sidebar,
  topNav: [
    { text: "Docs", link: "/docs/get-started", match: "/docs" },
    { text: "Blog", link: "/blog" },
    {
      text: "Examples",
      link: "https://github.com/ponder-sh/ponder/tree/main/examples",
    },
    {
      text: "Resources",
      items: [
        { text: "Migration guide", link: "/docs/migration-guide" },
        { text: "Community chat", link: "https://t.me/pondersh" },
        {
          text: "GitHub issues",
          link: "https://github.com/ponder-sh/ponder/issues",
        },
        {
          text: "Changelog",
          link: "https://github.com/ponder-sh/ponder/blob/main/packages/core/CHANGELOG.md",
        },
        {
          text: "Contribute",
          link: "https://github.com/ponder-sh/ponder/blob/main/.github/CONTRIBUTING.md",
        },
      ],
    },
  ],
  // Let agents navigate the docs and the Ponder source from one endpoint.
  mcp: {
    enabled: true,
    sources: [
      McpSource.github({
        name: "ponder",
        repo: "ponder-sh/ponder",
        paths: ["packages/core/src", "examples"],
      }),
    ],
  },
  search: {
    query: {
      // Self-contained for the same serialization reason as `head` below.
      boostDocument(_id, _term, storedFields) {
        const href =
          typeof storedFields?.href === "string" ? storedFields.href : "";
        // Demote archived versions at "/docs/{major}.{minor}/".
        if (/^\/docs\/\d+\.\d+\//.test(href)) return 0;
        if (href.startsWith("/docs/api-reference")) return 0.5;
        return 1;
      },
    },
  },
  /**
   * NOTE: Vocs serializes config functions with `Function.prototype.toString`
   * and re-evaluates them via `new Function(...)`, so this callback runs in a
   * bare scope: it cannot reference imports or module-scope values, and must
   * inline anything it needs.
   *
   * Archived pages get a canonical tag pointing at their equivalent page in
   * the latest docs, so search engines and LLMs consolidate on current
   * content. The two rename exceptions and the one removed page below are
   * asserted against `versions.ts` by `scripts/verify-versions.ts`.
   */
  head(path) {
    const preload = [
      { rel: "preload", as: "image", href: "/hero.png" },
    ] as const;
    const analytics = [
      { src: "https://sa-api.ponder.sh/latest.js", async: true },
    ] as const;
    // Canonical URLs always point at production: they must be byte-identical
    // on the server and in the browser or React reports a hydration mismatch
    // (Vocs embeds the canonical URL in its JSON-LD), and a canonical tag
    // should never point at localhost or a preview deployment. Kept in sync
    // with `productionUrl` in `base-url.ts` by `scripts/verify-versions.ts`.
    const origin = "https://ponder.sh";

    const archived = /^\/docs\/\d+\.\d+(?=\/)/.exec(path);
    if (archived === null)
      return { link: [...preload], script: [...analytics] };

    // Pages whose slug changed between the archived version and latest.
    const renamed: Record<string, string> = {
      "/docs/config/networks": "/docs/config/chains",
      "/docs/query/sql-client": "/docs/query/sql-over-http",
    };
    // Pages that no longer exist, so have no canonical equivalent.
    const removed = ["/docs/advanced/telemetry"];

    const stripped = `/docs${path.slice(archived[0].length)}`;
    const canonical = renamed[stripped] ?? stripped;
    if (removed.includes(canonical))
      return {
        canonical: false,
        link: [...preload],
        script: [...analytics],
      };

    return {
      canonical: `${origin}${canonical}`,
      link: [...preload],
      script: [...analytics],
    };
  },
  socials: [
    { icon: "github", link: "https://github.com/ponder-sh/ponder" },
    { icon: "telegram", link: "https://t.me/pondersh" },
    { icon: "x", link: "https://x.com/ponder_sh" },
  ],
  editLink: {
    link: "https://github.com/ponder-sh/ponder/edit/main/docs/pages/:path",
    text: "Suggest changes",
  },
});
