import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // wall/ is a standalone script with its own node:test suite; apps/ and packages/ run their own tests
    exclude: [...configDefaults.exclude, 'wall/**', 'apps/**', 'packages/**'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
