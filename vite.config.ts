import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // The playwright-evidence skill ships its own node:test suites; Vitest scans
  // dotdirs, so without this it picks them up and fails on the missing suite.
  // They run via: npm run test:skills
  test: { exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'] },
})
