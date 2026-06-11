import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

export default defineConfig(({ mode }) => ({
  plugins: [svelte()],
  // Deployed at https://<user>.github.io/Brain/ — assets need the subpath.
  base: mode === 'production' ? '/Brain/' : '/',
  build: {
    target: 'es2022'
  },
  test: {
    include: ['src/**/*.test.ts']
  }
}))
