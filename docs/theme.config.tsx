import { useRouter } from "next/router";
import type { DocsThemeConfig } from "nextra-theme-docs";
import { useConfig } from "nextra-theme-docs";

import PonderLogo from "./public/ponder.svg";
import TelegramLogo from "./public/telegram.svg";

const config: DocsThemeConfig = {
  logo: <PonderLogo className="logo" />,
  project: {
    link: "https://github.com/0xOlias/ponder",
  },
  chat: {
    link: "https://t.me/ponder_sh",
    icon: <TelegramLogo className="telegram" />,
  },
  docsRepositoryBase: "https://github.com/0xOlias/ponder/tree/main/docs",
  sidebar: {
    defaultMenuCollapseLevel: 2,
  },
  primaryHue: 186,
  primarySaturation: 86,
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
    </>
  ),
  useNextSeoProps() {
    const { route } = useRouter();
    const { frontMatter } = useConfig();

    const defaultSeoProps = {
      description: "Ponder is a backend framework for crypto apps.",
      openGraph: {
        description: "Ponder is a backend framework for crypto apps.",
        title: "Ponder – A backend framework for crypto apps",
        images: [{ url: "https://ponder.sh/og.png" }],
      },
      themeColor: "#FFFBF5",
      twitter: {
        cardType: "summary_large_image",
        handle: "@ponder_sh",
        site: "https://ponder.sh",
      },
    };

    if (!/^\/index/.test(route))
      return {
        ...defaultSeoProps,
        description: frontMatter.description,
        openGraph: {
          ...defaultSeoProps.openGraph,
          description: frontMatter.description,
          title: frontMatter.title,
        },
        titleTemplate: `%s – Ponder`,
      };
    return {
      ...defaultSeoProps,
      title: "Ponder: The Blockchain Backend Framework",
    };
  },
};

export default config;
