import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()],
  base: '/web/',
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:3005',
      '/health': 'http://127.0.0.1:3005',
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
