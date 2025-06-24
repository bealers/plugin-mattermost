import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import mattermostPlugin from '../src/index';
import { MattermostService } from '../src/services/mattermost.service';
import { elizaLogger } from '@elizaos/core';
import dotenv from 'dotenv';

// Setup environment variables
dotenv.config();

// Mock logger for testing
beforeAll(() => {
  vi.spyOn(elizaLogger, 'info');
  vi.spyOn(elizaLogger, 'error');
  vi.spyOn(elizaLogger, 'warn');
  vi.spyOn(elizaLogger, 'debug');
});

afterAll(() => {
  vi.restoreAllMocks();
});

// Create a mock runtime for testing
function createMockRuntime() {
  const services = new Map();

  return {
    character: {
      name: 'Test Character',
      system: 'You are a helpful assistant for testing.',
      plugins: [],
      settings: {},
    },
    getSetting: vi.fn(() => null),
    db: {
      get: vi.fn(() => null),
      set: vi.fn(() => true),
      delete: vi.fn(() => true),
      getKeys: vi.fn(() => []),
    },
    getService: vi.fn((serviceType: string) => services.get(serviceType)),
    registerService: vi.fn((serviceType: string, service: unknown) => {
      services.set(serviceType, service);
    }),
  };
}

describe('Plugin Structure', () => {
  it('should have correct plugin name', () => {
    expect(mattermostPlugin.name).toBe('mattermost');
  });

  it('should export the MattermostService in services array', () => {
    expect(mattermostPlugin.services).toBeDefined();
    expect(Array.isArray(mattermostPlugin.services)).toBe(true);
    expect(mattermostPlugin.services).toHaveLength(1);
    expect(mattermostPlugin.services[0]).toBe(MattermostService);
  });

  it('should have a clean, minimal plugin structure', () => {
    const pluginKeys = Object.keys(mattermostPlugin);
    expect(pluginKeys).toEqual(['name', 'services']);
  });
});

describe('MattermostService Integration', () => {
  it('should have the correct service type', () => {
    expect(MattermostService.serviceType).toBe('mattermost');
  });

  it('should be constructable', () => {
    const runtime = createMockRuntime();
    const service = new MattermostService(runtime as any);
    expect(service).toBeDefined();
    expect(service.constructor.name).toBe('MattermostService');
  });

  it('should have required service methods', () => {
    const runtime = createMockRuntime();
    const service = new MattermostService(runtime as any);
    
    // Check that essential methods exist
    expect(typeof service.stop).toBe('function');
    expect(typeof service.isReady).toBe('function');
    expect(typeof service.getConfiguration).toBe('function');
    expect(typeof service.sendMessage).toBe('function');
  });

  it('should have static start method', () => {
    expect(typeof MattermostService.start).toBe('function');
    expect(MattermostService.start).toBeDefined();
  });
});
