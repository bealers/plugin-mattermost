import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load test configuration for E2E tests (requires containerized setup)
const testConfigPath = path.resolve(__dirname, '__tests__/generated-test-config.env');
try {
  config({ path: testConfigPath });
} catch {
  console.warn('Test configuration not found. Run "npm run test:setup" first.');
}

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