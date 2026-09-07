import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 4173, host: '0.0.0.0', allowedHosts: ['terminal.local'] },
  test: {
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, '**/dist/**'],
    testTimeout: 10_000,
  },
})
