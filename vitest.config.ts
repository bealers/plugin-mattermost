import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

// Load test configuration if available (from containerized setup)
const testConfigPath = path.resolve(__dirname, '__tests__/generated-test-config.env');
try {
  config({ path: testConfigPath });
} catch {
  // Test config not available, that's fine for unit tests
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 60000,
    exclude: ['**/e2e/**', '**/node_modules/**', '**/.bealers/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
