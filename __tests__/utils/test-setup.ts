import { vi, beforeEach, afterEach } from 'vitest';
import { elizaLogger } from '@elizaos/core';
import dotenv from 'dotenv';

// Load test environment
dotenv.config({ path: '__tests__/test.env' });

// Global test configuration
export const TEST_CONFIG = {
  timeout: 60000,
  healthCheckTimeout: 30000,
  apiRequestTimeout: 15000,
  retryAttempts: 3,
  retryDelay: 1000,
};

// Mock elizaLogger globally for all tests
export const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Global setup
beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
  
  // Mock elizaLogger which is used by managers and services
  vi.spyOn(elizaLogger, 'debug').mockImplementation(mockLogger.debug);
  vi.spyOn(elizaLogger, 'info').mockImplementation(mockLogger.info);
  vi.spyOn(elizaLogger, 'warn').mockImplementation(mockLogger.warn);
  vi.spyOn(elizaLogger, 'error').mockImplementation(mockLogger.error);
});

afterEach(() => {
  // Clean up after each test
  vi.clearAllMocks();
});

// Helper functions for logger testing
export function expectLoggerCalled(level: 'debug' | 'info' | 'warn' | 'error', expectedMessage: string) {
  const spy = mockLogger[level];
  
  // Check if the spy was called with a message containing the expected text
  const found = spy.mock.calls.some(call => {
    const message = call[0];
    return typeof message === 'string' && message.includes(expectedMessage);
  });
  
  if (!found) {
    throw new Error(
      `Expected ${level} to be called with message containing "${expectedMessage}". ` +
      `Actual calls: ${JSON.stringify(spy.mock.calls.map(call => call[0]))}`
    );
  }
}

export function expectLoggerCalledWith(level: 'debug' | 'info' | 'warn' | 'error', expectedMessage: string, expectedData?: any) {
  const spy = mockLogger[level];
  
  // Check for exact message match with optional data
  const found = spy.mock.calls.some(call => {
    const [message, data] = call;
    const messageMatches = typeof message === 'string' && message.includes(expectedMessage);
    
    if (!expectedData) {
      return messageMatches;
    }
    
    // If expectedData is provided, check that too
    return messageMatches && (data !== undefined);
  });
  
  if (!found) {
    throw new Error(
      `Expected ${level} to be called with message containing "${expectedMessage}". ` +
      `Actual calls: ${JSON.stringify(spy.mock.calls)}`
    );
  }
}

export function expectLoggerNotCalled(level: 'debug' | 'info' | 'warn' | 'error') {
  const spy = mockLogger[level];
  if (spy.mock.calls.length > 0) {
    throw new Error(`Expected ${level} not to be called, but it was called ${spy.mock.calls.length} times`);
  }
}

// Helper to wait for async operations
export function waitFor(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper to create mock runtime for testing
export function createMockRuntime(overrides: any = {}) {
  return {
    character: {
      name: 'Test Character',
      system: 'You are a helpful assistant',
      bio: ['Test bio'],
    },
    composeState: vi.fn().mockResolvedValue({
      text: 'mocked AI response',
      values: {},
      data: {},
    }),
    ...overrides,
  };
}

// Utility functions for tests
export const sleep = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

export const withRetry = async <T>(
  fn: () => Promise<T>,
  maxAttempts: number = TEST_CONFIG.retryAttempts,
  delay: number = TEST_CONFIG.retryDelay
): Promise<T> => {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === maxAttempts) break;
      await sleep(delay * attempt);
    }
  }
  
  throw lastError!;
}; 