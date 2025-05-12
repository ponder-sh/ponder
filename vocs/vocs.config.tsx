import { remarkMermaid } from "@theguild/remark-mermaid";
import { defineConfig } from "vocs";
import pkg from "../packages/core/package.json";
import { sidebar } from "./sidebar";

export default defineConfig({
  title: "Ponder",
  titleTemplate: "%s – Ponder",
  description:
    "Ponder is an open-source backend framework for robust, performant, and maintainable crypto apps.",
  rootDir: ".",
  baseUrl:
    process.env.VERCEL_ENV === "production"
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : `https://${process.env.VERCEL_URL}`,
  markdown: { remarkPlugins: [remarkMermaid] },
  sidebar,
  topNav: [
    { text: "Docs", link: "/docs/get-started", match: "/docs" },
    {
      text: "Blog",
      link: "/blog",
      // items: [
      //   {
      //     text: "Introducing Ponder",
      //     link: "/blog/introducing-ponder",
      //   },
      // ],
    },
    {
      text: "Examples",
      link: "https://github.com/ponder-sh/ponder/tree/main/examples",
    },
    {
      text: pkg.version,
      items: [
        {
          text: "Migration guide",
          link: "/docs/migration-guide",
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
  head() {
    return (
      <>
        <link rel="preload" as="image" href="/hero.png" />
        <script async src="https://sa-api.ponder.sh/latest.js" />
        <noscript>
          <img
            src="https://sa-api.ponder.sh/noscript.gif"
            alt=""
            referrerPolicy="no-referrer-when-downgrade"
          />
        </noscript>
      </>
    );
  },
  // ogImageUrl: {
  //   '/': '/og-image.png',
  //   '/docs':
  //     'https://vocs.dev/api/og?logo=%logo&title=%title&description=%description',
  //   '/op-stack':
  //     'https://vocs.dev/api/og?logo=%logo&title=%title&description=%description',
  // },
  // iconUrl: { light: '/favicons/light.png', dark: '/favicons/dark.png' },
  logoUrl: { light: "/ponder-light.svg", dark: "/ponder-dark.svg" },
  socials: [
    {
      icon: "github",
      link: "https://github.com/ponder-sh/ponder",
    },
    {
      icon: "telegram",
      link: "https://t.me/ponder_sh",
    },
    {
      icon: "x",
      link: "https://x.com/ponder_sh",
    },
    // {
    //   icon: "warpcast",
    //   link: "https://warpcast.com/~/channel/ponder-sh",
    // },
  ],
  editLink: {
    pattern: "https://github.com/ponder-sh/ponder/edit/main/vocs/pages/:path",
    text: "Suggest changes",
  },
  theme: {
    accentColor: {
      light: "#0a9fb2",
      dark: "#10c2d5",
    },
    variables: {
      content: {
        width: "calc(70ch + (var(--vocs-content_horizontalPadding) * 2))",
      },
      fontSize: {
        codeBlock: "13px", // Default: 14px
      },
    },
  },
});

function toPatchVersionRange(version: string) {
  const [major, minor] = version.split(".").slice(0, 2);
  return `${major}.${minor}.x`;
}
