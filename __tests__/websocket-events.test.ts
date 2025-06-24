import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketClient } from '../src/clients/websocket.client';
import { elizaLogger } from '@elizaos/core';

// Mock WebSocket
const mockWebSocket = {
  readyState: 1, // OPEN
  send: vi.fn(),
  close: vi.fn(),
  removeAllListeners: vi.fn(),
  once: vi.fn(),
  on: vi.fn(),
};

// Mock the ws module
vi.mock('ws', () => ({
  default: vi.fn(() => mockWebSocket),
}));

// Mock @mattermost/client
vi.mock('@mattermost/client', () => ({
  default: {
    Client4: vi.fn(() => ({
      setUrl: vi.fn(),
      setToken: vi.fn(),
      getWebSocketUrl: vi.fn().mockReturnValue('wss://example.com/api/v4/websocket'),
    })),
  },
}));

// Mock config loading
vi.mock('../src/config', () => ({
  loadConfig: vi.fn(() => ({
    env: {
      MATTERMOST_SERVER_URL: 'https://test.example.com',
      MATTERMOST_TOKEN: 'test-token',
      MATTERMOST_TEAM: 'test-team',
      MATTERMOST_TEST_CHANNEL: 'test-channel'
    }
  }))
}));

describe('WebSocketClient Event System', () => {
  let client: WebSocketClient;
  let mockRuntime: any;
  let config: any;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Create mock config
    config = {
      env: {
        MATTERMOST_SERVER_URL: 'https://test.example.com',
        MATTERMOST_TOKEN: 'test-token',
        MATTERMOST_TEAM: 'test-team',
        MATTERMOST_TEST_CHANNEL: 'test-channel'
      }
    };
    
    // Create mock runtime
    mockRuntime = {
      character: { name: 'TestBot' },
      logger: elizaLogger,
    };

    // Create client instance
    client = new WebSocketClient(config, mockRuntime);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Event Listener Registration', () => {
    it('should register event listeners correctly', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      client.on('test_event', callback1);
      client.on('test_event', callback2);

      expect(client.listenerCount('test_event')).toBe(2);
      expect(client.eventNames()).toContain('test_event');
    });

    it('should register wildcard listeners', () => {
      const wildcardCallback = vi.fn();
      
      client.on('*', wildcardCallback);
      
      expect(client.listenerCount('*')).toBe(1);
      expect(client.eventNames()).toContain('*');
    });

    it('should support multiple listeners for the same event', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      client.on('multi_event', callback1);
      client.on('multi_event', callback2);
      client.on('multi_event', callback3);

      expect(client.listenerCount('multi_event')).toBe(3);
    });
  });

  describe('Event Listener Removal', () => {
    it('should remove specific listeners', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      client.on('test_event', callback1);
      client.on('test_event', callback2);
      
      expect(client.listenerCount('test_event')).toBe(2);
      
      client.off('test_event', callback1);
      
      expect(client.listenerCount('test_event')).toBe(1);
    });

    it('should clean up empty listener sets', () => {
      const callback = vi.fn();

      client.on('cleanup_test', callback);
      expect(client.eventNames()).toContain('cleanup_test');
      
      client.off('cleanup_test', callback);
      expect(client.eventNames()).not.toContain('cleanup_test');
    });

    it('should remove all listeners for a specific event', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      client.on('remove_all_test', callback1);
      client.on('remove_all_test', callback2);
      client.on('other_event', callback1);
      
      expect(client.listenerCount('remove_all_test')).toBe(2);
      expect(client.listenerCount('other_event')).toBe(1);
      
      client.removeAllListeners('remove_all_test');
      
      expect(client.listenerCount('remove_all_test')).toBe(0);
      expect(client.listenerCount('other_event')).toBe(1);
    });

    it('should remove all listeners when no event specified', () => {
      const callback = vi.fn();

      client.on('event1', callback);
      client.on('event2', callback);
      client.on('*', callback);
      
      expect(client.eventNames()).toHaveLength(3);
      
      client.removeAllListeners();
      
      expect(client.eventNames()).toHaveLength(0);
    });
  });

  describe('One-time Listeners', () => {
    it('should register and auto-remove once listeners', () => {
      const callback = vi.fn();

      client.once('once_event', callback);
      expect(client.listenerCount('once_event')).toBe(1);
      
      // Emit event
      client.emit('once_event', { test: 'data' });
      
      // Callback should have been called
      expect(callback).toHaveBeenCalledTimes(1);
      
      // Listener should be auto-removed
      expect(client.listenerCount('once_event')).toBe(0);
    });

    it('should call once listeners with correct data', () => {
      const callback = vi.fn();
      const testData = { message: 'test', id: 123 };

      client.once('data_test', callback);
      client.emit('data_test', testData);

      expect(callback).toHaveBeenCalledWith(testData);
    });
  });

  describe('Event Emission', () => {
    it('should emit events to specific listeners', () => {
      const callback = vi.fn();
      const testData = { test: 'data' };

      client.on('emit_test', callback);
      client.emit('emit_test', testData);

      expect(callback).toHaveBeenCalledWith(testData, expect.objectContaining({
        event: 'emit_test',
        data: testData,
        timestamp: expect.any(Number)
      }));
    });

    it('should emit events to wildcard listeners', () => {
      const wildcardCallback = vi.fn();
      const specificCallback = vi.fn();
      const testData = { test: 'wildcard' };

      client.on('*', wildcardCallback);
      client.on('wildcard_test', specificCallback);
      
      client.emit('wildcard_test', testData);

      // Both callbacks should be called
      expect(specificCallback).toHaveBeenCalledTimes(1);
      expect(wildcardCallback).toHaveBeenCalledTimes(1);
      
      // Both should receive the same data
      expect(specificCallback).toHaveBeenCalledWith(testData, expect.objectContaining({
        event: 'wildcard_test'
      }));
      expect(wildcardCallback).toHaveBeenCalledWith(testData, expect.objectContaining({
        event: 'wildcard_test'
      }));
    });

    it('should include metadata in event emission', () => {
      const callback = vi.fn();
      const testData = { test: 'data' };
      const metadata = { source: 'test', priority: 'high' };

      client.on('metadata_test', callback);
      client.emit('metadata_test', testData, metadata);

      expect(callback).toHaveBeenCalledWith(testData, expect.objectContaining({
        event: 'metadata_test',
        data: testData,
        metadata,
        timestamp: expect.any(Number)
      }));
    });

    it('should handle listener errors gracefully', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Test error');
      });
      const goodCallback = vi.fn();

      client.on('error_test', errorCallback);
      client.on('error_test', goodCallback);

      // Should not throw
      expect(() => {
        client.emit('error_test', { test: 'data' });
      }).not.toThrow();

      // Good callback should still be called
      expect(goodCallback).toHaveBeenCalledTimes(1);
      expect(errorCallback).toHaveBeenCalledTimes(1);
    });

    it('should not emit wildcard events to wildcard listeners recursively', () => {
      const wildcardCallback = vi.fn();

      client.on('*', wildcardCallback);
      client.emit('*', { test: 'wildcard' });

      // Should only be called once (not recursively)
      expect(wildcardCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('Event Names and Listener Counts', () => {
    it('should return correct event names', () => {
      client.on('event1', vi.fn());
      client.on('event2', vi.fn());
      client.on('*', vi.fn());

      const eventNames = client.eventNames();
      expect(eventNames).toContain('event1');
      expect(eventNames).toContain('event2');
      expect(eventNames).toContain('*');
      expect(eventNames).toHaveLength(3);
    });

    it('should return correct listener counts', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      expect(client.listenerCount('nonexistent')).toBe(0);

      client.on('count_test', callback1);
      client.on('count_test', callback2);
      
      expect(client.listenerCount('count_test')).toBe(2);
    });

    it('should handle empty event names array', () => {
      expect(client.eventNames()).toHaveLength(0);
    });
  });

  describe('WebSocket Message Handling', () => {
    it('should emit authentication events correctly', () => {
      const authCallback = vi.fn();
      
      client.on('authenticated', authCallback);
      
      // Simulate authentication message
      const authMessage = {
        event: 'hello',
        data: { server_version: '5.0.0' },
        broadcast: null,
        seq: 1
      };

      // Access private method for testing
      (client as any).handleMessage(JSON.stringify(authMessage));

      expect(authCallback).toHaveBeenCalledWith(
        { server_version: '5.0.0' },
        expect.objectContaining({
          event: 'authenticated',
          metadata: expect.objectContaining({
            originalMessage: authMessage
          })
        })
      );
    });

    it('should emit regular events with proper metadata', () => {
      const messageCallback = vi.fn();
      const wildcardCallback = vi.fn();
      
      client.on('posted', messageCallback);
      client.on('*', wildcardCallback);
      
      // Simulate message event
      const messageEvent = {
        event: 'posted',
        data: {
          post: {
            id: 'post123',
            message: 'Hello World',
            channel_id: 'channel123'
          }
        },
        broadcast: {
          omit_users: null,
          user_id: 'user123',
          channel_id: 'channel123',
          team_id: 'team123'
        },
        seq: 2
      };

      // Access private method for testing
      (client as any).handleMessage(JSON.stringify(messageEvent));

      // Specific listener should be called
      expect(messageCallback).toHaveBeenCalledWith(
        messageEvent.data,
        expect.objectContaining({
          event: 'posted',
          metadata: expect.objectContaining({
            originalMessage: messageEvent,
            broadcast: messageEvent.broadcast,
            seq: messageEvent.seq
          })
        })
      );

      // Wildcard listener should also be called
      expect(wildcardCallback).toHaveBeenCalledWith(
        messageEvent.data,
        expect.objectContaining({
          event: 'posted'
        })
      );
    });
  });
}); 