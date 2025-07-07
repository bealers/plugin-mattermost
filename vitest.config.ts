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
    setupFiles: ['__tests__/utils/test-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      exclude: [
        'node_modules/**',
        '__tests__/**',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/types/**',
        '**/*.d.ts',
      ],
      thresholds: {
        global: {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
