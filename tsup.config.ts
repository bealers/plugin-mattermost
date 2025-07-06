import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  tsconfig: './tsconfig.build.json', // Use build-specific tsconfig
  sourcemap: true,
  clean: true,
  format: ['esm'], // Ensure you're targeting CommonJS
  dts: true, // require DTS so we get d.ts in the dist folder on npm
  external: [
    // Node.js built-ins
    'dotenv',
    'fs',
    'path',
    'https',
    'http',
    'crypto',
    'util',
    'events',
    'stream',
    'buffer',
    'url',
    // Core dependencies
    '@elizaos/core',
    'zod',
    // Common problematic dependencies
    'mime-types',
    'mime-db',
    'form-data',
    'ws',
    'axios',
  ],
});
