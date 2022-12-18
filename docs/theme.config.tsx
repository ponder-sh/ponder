import { useRouter } from "next/router";
import type { DocsThemeConfig } from "nextra-theme-docs";
import { useConfig } from "nextra-theme-docs";

const config: DocsThemeConfig = {
  logo: <span style={{ fontWeight: 700, fontSize: 22 }}>Ponder</span>,
  project: {
    link: "https://github.com/0xOlias/ponder",
  },
  chat: {
    icon: null,
  },
  docsRepositoryBase: "https://github.com/0xOlias/ponder/tree/main/docs",
  editLink: {
    text: "Edit this page on GitHub →",
  },
  feedback: {
    content: null,
  },
  navigation: {
    prev: true,
    next: true,
  },
  footer: {
    component: null,
  },
  darkMode: true,
  nextThemes: {
    defaultTheme: "dark",
  },
  faviconGlyph: "🤔",
  head: (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <meta httpEquiv="Content-Language" content="en" />

      {/* <link rel="icon" type="image/svg+xml" href="/favicons/favicon.svg" />
      <link rel="icon" type="image/png" href="/favicons/light.png" />
      <link
        rel="icon"
        type="image/png"
        href="/favicons/dark.png"
        media="(prefers-color-scheme: dark)"
      /> */}
    </>
  ),
  useNextSeoProps() {
    const { route } = useRouter();
    const { frontMatter } = useConfig();

    const defaultSeoProps = {
      description:
        "Ponder is a framework for building web services that interact blockchain data.",
      openGraph: {
        description:
          "Ponder is a framework for building web services that interact blockchain data.",
        title: "Ponder: A Node.js Framework for Ethereum",
        images: [{ url: "https://ponder.sh/og.png" }],
      },
      themeColor: "#ffffff",
      twitter: {
        cardType: "summary_large_image",
        // handle: "@ponder_sh",
        site: "ponder.sh",
      },
    };

    if (!/^\/index/.test(route))
      return {
        ...defaultSeoProps,
        description: frontMatter.description,
        openGraph: {
          ...defaultSeoProps.openGraph,
          description: frontMatter.description,
          // images: frontMatter.image
          //   ? [{ url: frontMatter.image }]
          //   : defaultSeoProps.openGraph.images,
          title: frontMatter.title,
        },
        titleTemplate: `%s – Ponder`,
      };
    return {
      ...defaultSeoProps,
      title: "Ponder: A Node.js Framework for Ethereum",
    };
  },
};

export default config;
