<script setup lang="ts">
import { ref, computed } from 'vue'
/**
 * props
 */
const props = defineProps<{ text: string; }>()
/**
 * state?
 */
const count = ref(0)
/**
 * mutations?
 */
const increment = () => count.value++
/**
 * computed?
 */
const result = computed(() => count.value)
</script>

<template>
  <section class="space-y-4 w-full">
    <p>{{ props.text }}</p>
    <p>Count is: {{ result }}</p>
    <button @click="increment"
      class="bg-pink-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-2xl w-[150px]">Increment</button>
  </section>
</template> 