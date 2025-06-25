import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 180000, // 3 minutes for E2E tests
    hookTimeout: 60000,  // 1 minute for setup/teardown
    // Don't exclude e2e directory for E2E config
    exclude: ['**/node_modules/**', '**/.bealers/**'],
    setupFiles: ['__tests__/e2e/test-env.setup.ts'],
    silent: false,
    reporter: 'verbose'
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}); 