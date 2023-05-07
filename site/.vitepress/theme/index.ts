import defaultTheme from 'vitepress/theme'
import VueComponent from './components/VueComponent.vue'
import type { EnhanceAppContext } from 'vitepress'
import 'uno.css'

export default {
  ...defaultTheme,
  enhanceApp: ({ app }: EnhanceAppContext) => {
    app.component('VueComponent', VueComponent)
  },
}
