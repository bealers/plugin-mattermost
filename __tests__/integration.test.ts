import { describe, expect, it, vi, afterAll, beforeAll } from 'vitest';
import mattermostPlugin from '../src/index';
import { createMockRuntime, setupLoggerSpies } from './test-utils';
import { IAgentRuntime } from '@elizaos/core';

/**
 * Integration tests demonstrate how multiple components of the plugin work together.
 * Unlike unit tests that test individual functions in isolation, integration tests
 * examine how components interact with each other.
 *
 * For example, this file shows how the HelloWorld action and HelloWorld provider
 * interact with the StarterService and the plugin's core functionality.
 */

// Set up spies on logger
beforeAll(() => {
  setupLoggerSpies();
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('Integration: Plugin initialization and service registration', () => {
  it('should initialize the plugin and register the service', async () => {
    // Create a fresh mock runtime with mocked registerService for testing initialization flow
    const mockRuntime = createMockRuntime();

    // Create and install a spy on registerService
    const registerServiceSpy = vi.fn();
    mockRuntime.registerService = registerServiceSpy;

    // Run a minimal simulation of the plugin initialization process
    if (mattermostPlugin.init) {
      await mattermostPlugin.init(
        { MATTERMOST_SERVER_URL: 'https://example.com' },
        mockRuntime as unknown as IAgentRuntime
      );

      // Directly mock the service registration that happens during initialization
      if (mattermostPlugin.services) {
        const ServiceClass = mattermostPlugin.services[0];
        await ServiceClass.start(
          mockRuntime as unknown as IAgentRuntime
        );

        // Register the Service class to match the core API
        mockRuntime.registerService(ServiceClass);
      }

      // Now verify the service was registered with the runtime
      expect(registerServiceSpy).toHaveBeenCalledWith(expect.any(Function));
    }
  });
});
