# Testing Guide

This plugin uses a comprehensive unit testing approach with modern testing infrastructure aligned with the monorepo patterns.

## Quick Start

```bash
# Install dependencies
npm install

# Run all unit tests
npm run test:unit

# Run tests with coverage
npm run test:coverage
```

## Test Structure

- **`__tests__/unit/`** - Unit tests for all plugin components
- **`__tests__/utils/`** - Test utilities, mocks, and shared setup
- **`vitest.config.ts`** - Test configuration with coverage reporting

## Test Types

- `npm run test:unit` - All unit tests
- `npm run test:coverage` - Unit tests with coverage reporting (80% minimum threshold)

## Test Infrastructure

The test suite uses:
- **Vitest** - Modern test runner with excellent TypeScript support
- **Comprehensive Mocking** - Full elizaOS runtime and Mattermost API mocking
- **Global Setup** - Standardised test environment and logger mocking
- **Coverage Reporting** - Detailed coverage reports with configurable thresholds

## Test Configuration

Copy `test.env.example` to configure your test environment for local development testing.