---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "ponder"
  text: "A framework for blockchain application backends"
  tagline: Realtime indexer, automatic block-reorg handling
  actions:
    - theme: brand
      text: Get Started
      link: /docs/getting-started
    - theme: alt
      text: Playground
      link: /playground
    - theme: alt
      text: View on GitHub
      link: https://github.com/0xOlias/ponder

# features:
#   - title: Feature A
#     details: Lorem ipsum dolor sit amet, consectetur adipiscing elit
#   - title: Feature B
#     details: Lorem ipsum dolor sit amet, consectetur adipiscing elit
#   - title: Feature C
#     details: Lorem ipsum dolor sit amet, consectetur adipiscing elit
---

<script setup lang="ts">
  import VueComponent from './.vitepress/theme/components/VueComponent.vue'
</script>

<main class="m-auto flex flex-col justify-center align-middle w-72 text-center">
  <VueComponent text="text from markdown" />
</main>
