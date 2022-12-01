const withNextra = require("nextra")({
  theme: "nextra-theme-docs",
  themeConfig: "./theme.config.js",
  unstable_contentDump: true,
  unstable_defaultShowCopyCode: true,
  unstable_flexsearch: {
    codeblocks: true,
  },
  unstable_staticImage: true,
});

module.exports = withNextra();
