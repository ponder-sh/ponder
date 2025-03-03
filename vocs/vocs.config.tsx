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
      ? "https://ponder.sh"
      : process.env.VERCEL_URL,
  sidebar,
  topNav: [
    { text: "Docs", link: "/docs/getting-started", match: "/docs" },
    {
      text: "Examples",
      link: "https://github.com/ponder-sh/ponder/tree/main/examples",
    },
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
      text: pkg.version,
      items: [
        {
          text: `Migrating to ${toPatchVersionRange(pkg.version)}`,
          link: `/docs/migration-guide#_${toPatchVersionRange(
            pkg.version,
          ).replace(/\./g, "-")}-breaking-changes`,
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
    text: "Suggest changes to this page",
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
    },
  },
});

function toPatchVersionRange(version: string) {
  const [major, minor] = version.split(".").slice(0, 2);
  return `${major}.${minor}.x`;
}
