const withNextra = require("nextra")({
  theme: "nextra-theme-docs",
  themeConfig: "./theme.config.tsx",
  defaultShowCopyCode: true,
  flexsearch: {
    codeblocks: true,
  },
  staticImage: true,
});

module.exports = withNextra({
  redirects() {
    return [
      // Redirects for old docs
      {
        source: "/faq/vs-the-graph",
        destination: "/compared-to-subgraphs",
        permanent: true,
      },
      { source: "/faq/database", destination: "/", permanent: true },
    ];
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    return config;
  },
});
