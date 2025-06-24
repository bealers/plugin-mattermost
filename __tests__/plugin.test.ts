import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import mattermostPlugin, { MattermostService } from '../src/index';
import { ModelType, logger } from '@elizaos/core';
import dotenv from 'dotenv';

// Setup environment variables
dotenv.config();

// Need to spy on logger for documentation
beforeAll(() => {
  vi.spyOn(logger, 'info');
  vi.spyOn(logger, 'error');
  vi.spyOn(logger, 'warn');
  vi.spyOn(logger, 'debug');
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Create a real runtime for testing
function createRealRuntime() {
  const services = new Map();

  // Create a real service instance if needed
  const createService = (serviceType: string) => {
    if (serviceType === MattermostService.serviceType) {
      return new MattermostService({
        character: {
          name: 'Test Character',
          system: 'You are a helpful assistant for testing.',
        },
      } as unknown);
    }
    return null;
  };

  return {
    character: {
      name: 'Test Character',
      system: 'You are a helpful assistant for testing.',
      plugins: [],
      settings: {},
    },
    getSetting: () => null,
    models: mattermostPlugin.models,
    db: {
      get: () => null,
      set: () => true,
      delete: () => true,
      getKeys: () => [],
    },
    getService: (serviceType: string) => {
      // Log the service request for debugging
      logger.debug(`Requesting service: ${serviceType}`);

      // Get from cache or create new
      if (!services.has(serviceType)) {
        logger.debug(`Creating new service: ${serviceType}`);
        services.set(serviceType, createService(serviceType));
      }

      return services.get(serviceType);
    },
    registerService: (_serviceType: string, service: unknown) => {
      logger.debug(`Registering service: ${_serviceType}`);
      services.set(_serviceType, service);
    },
  };
}

describe('Plugin Configuration', () => {
  it('should have correct plugin metadata', () => {
    expect(mattermostPlugin.name).toBe('plugin-mattermost-client');
    expect(mattermostPlugin.description).toMatch(/Mattermost client plugin/);
    expect(mattermostPlugin.config).toBeDefined();
  });

  it('should include the MATTERMOST_SERVER_URL in config', () => {
    expect(mattermostPlugin.config).toHaveProperty('MATTERMOST_SERVER_URL');
  });

  it('should initialize properly', async () => {
    const runtime = createRealRuntime();
    if (mattermostPlugin.init) {
      await mattermostPlugin.init({ MATTERMOST_SERVER_URL: 'https://example.com' }, runtime as unknown);
      expect(true).toBe(true); // If we got here, init succeeded
    }
  });

  it('should have a valid config', () => {
    expect(mattermostPlugin.config).toBeDefined();
    if (mattermostPlugin.config) {
      // Check if the config has expected MATTERMOST_SERVER_URL property
      expect(Object.keys(mattermostPlugin.config)).toContain('MATTERMOST_SERVER_URL');
    }
  });
});

describe('Plugin Models', () => {
  it('should have TEXT_SMALL model defined', () => {
    expect(mattermostPlugin.models?.[ModelType.TEXT_SMALL]).toBeDefined();
    if (mattermostPlugin.models) {
      expect(typeof mattermostPlugin.models[ModelType.TEXT_SMALL]).toBe('function');
    }
  });

  it('should have TEXT_LARGE model defined', () => {
    expect(mattermostPlugin.models?.[ModelType.TEXT_LARGE]).toBeDefined();
    if (mattermostPlugin.models) {
      expect(typeof mattermostPlugin.models[ModelType.TEXT_LARGE]).toBe('function');
    }
  });

  it('should return a response from TEXT_SMALL model', async () => {
    if (mattermostPlugin.models?.[ModelType.TEXT_SMALL]) {
      const runtime = createRealRuntime();
      const result = await mattermostPlugin.models[ModelType.TEXT_SMALL](runtime as unknown, {
        prompt: 'test',
      });

      // Check that we get a non-empty string response
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(5);
    }
  });
});

describe('MattermostService', () => {
  it('should start the service', async () => {
    const runtime = createRealRuntime();
    const startResult = await MattermostService.start(runtime as unknown);

    expect(startResult).toBeDefined();
    expect(startResult.constructor.name).toBe('MattermostService');

    // Test real functionality - check stop method is available
    expect(typeof startResult.stop).toBe('function');
  });

  it('should stop the service', async () => {
    const runtime = createRealRuntime();

    // Register a real service first
    const service = new MattermostService(runtime as unknown);
    runtime.registerService(MattermostService.serviceType, service);

    // Spy on the real service's stop method
    const stopSpy = vi.spyOn(service, 'stop');

    // Call the static stop method
    await service.stop();

    // Verify the service's stop method was called
    expect(stopSpy).toHaveBeenCalled();
  });
});
