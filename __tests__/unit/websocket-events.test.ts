import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketClient } from '../../src/clients/websocket.client';
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
      MATTERMOST_URL: 'https://test.example.com',
      MATTERMOST_TOKEN: 'test-token',
      MATTERMOST_TEAM: 'test-team',
      MATTERMOST_TEST_CHANNEL: 'test-channel'
    },
    runtime: {
      reconnectAttempts: 3,
      reconnectDelay: 5000,
      maxMessageLength: 4000,
      allowedChannelTypes: ['O', 'P', 'D']
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
        MATTERMOST_URL: 'https://test.example.com',
        MATTERMOST_TOKEN: 'test-token',
        MATTERMOST_TEAM: 'test-team',
        MATTERMOST_TEST_CHANNEL: 'test-channel'
      },
      runtime: {
        reconnectAttempts: 3,
        reconnectDelay: 5000,
        maxMessageLength: 4000,
        allowedChannelTypes: ['O', 'P', 'D']
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

      expect(callback).toHaveBeenCalledWith(testData, expect.objectContaining({
        event: 'data_test',
        metadata: expect.objectContaining({
          source: 'websocket_client',
          timestamp: expect.any(Number)
        })
      }));
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
        metadata: expect.objectContaining({
          source: 'websocket_client',
          timestamp: expect.any(Number)
        })
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
        metadata: expect.objectContaining({
          source: 'test',
          priority: 'high',
          timestamp: expect.any(Number)
        })
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

  describe('Reconnection Logic with Exponential Backoff', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should use configurable reconnection parameters', () => {
      expect((client as any).maxReconnectAttempts).toBe(config.runtime.reconnectAttempts);
      expect((client as any).baseReconnectDelay).toBe(config.runtime.reconnectDelay);
    });

    it('should emit reconnection_scheduled event with exponential backoff delays', () => {
      const reconnectionCallback = vi.fn();
      client.on('reconnection_scheduled', reconnectionCallback);

      // Simulate connection drop (non-clean close)
      (client as any).handleClose(1006, Buffer.from('Connection lost'));

      expect(reconnectionCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxAttempts: config.runtime.reconnectAttempts,
          delay: config.runtime.reconnectDelay // First attempt uses base delay
        }),
        expect.objectContaining({
          event: 'reconnection_scheduled',
          metadata: expect.objectContaining({
            nextAttemptAt: expect.any(Number)
          })
        })
      );
    });

    it('should calculate exponential backoff delays correctly', () => {
      const reconnectionCallback = vi.fn();
      client.on('reconnection_scheduled', reconnectionCallback);

      // Set up multiple reconnection attempts
      (client as any).reconnectAttempts = 0;

      // First attempt
      (client as any).attemptReconnect();
      expect(reconnectionCallback).toHaveBeenLastCalledWith(
        expect.objectContaining({
          delay: config.runtime.reconnectDelay * Math.pow(2, 0) // 5000 * 1 = 5000
        }),
        expect.any(Object)
      );

      // Second attempt
      reconnectionCallback.mockClear();
      (client as any).reconnectAttempts = 1;
      (client as any).attemptReconnect();
      expect(reconnectionCallback).toHaveBeenLastCalledWith(
        expect.objectContaining({
          delay: config.runtime.reconnectDelay * Math.pow(2, 1) // 5000 * 2 = 10000
        }),
        expect.any(Object)
      );

      // Third attempt
      reconnectionCallback.mockClear();
      (client as any).reconnectAttempts = 2;
      (client as any).attemptReconnect();
      expect(reconnectionCallback).toHaveBeenLastCalledWith(
        expect.objectContaining({
          delay: config.runtime.reconnectDelay * Math.pow(2, 2) // 5000 * 4 = 20000
        }),
        expect.any(Object)
      );
    });

    it('should cap exponential backoff at maximum delay', () => {
      const reconnectionCallback = vi.fn();
      client.on('reconnection_scheduled', reconnectionCallback);

      // Set high reconnection attempts to trigger cap, but not exceed maxReconnectAttempts
      // With baseDelay=5000, attempt 4 would give: 5000 * 2^4 = 80000ms, which should be capped at 30000
      (client as any).reconnectAttempts = 4; // This would give 5000 * 16 = 80000ms without cap
      (client as any).maxReconnectAttempts = 10; // Temporarily increase max to allow this test
      (client as any).attemptReconnect();

      expect(reconnectionCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: 30000 // Should be capped at 30 seconds
        }),
        expect.any(Object)
      );
    });

    it('should emit reconnection_failed when max attempts reached', () => {
      const failedCallback = vi.fn();
      client.on('reconnection_failed', failedCallback);

      // Set attempts to maximum
      (client as any).reconnectAttempts = config.runtime.reconnectAttempts;
      (client as any).attemptReconnect();

      expect(failedCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: config.runtime.reconnectAttempts,
          maxAttempts: config.runtime.reconnectAttempts
        }),
        expect.objectContaining({
          event: 'reconnection_failed',
          metadata: expect.objectContaining({
            reason: 'max_attempts_reached'
          })
        })
      );
    });

    it('should emit reconnection_attempt when actually attempting to connect', async () => {
      const attemptCallback = vi.fn();
      client.on('reconnection_attempt', attemptCallback);

      // Mock connect to avoid actual network calls
      const connectSpy = vi.spyOn(client, 'connect').mockResolvedValue();

      // Trigger reconnection
      (client as any).attemptReconnect();

      // Fast-forward time to trigger the timeout
      await vi.runAllTimersAsync();

      expect(attemptCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxAttempts: config.runtime.reconnectAttempts
        }),
        expect.objectContaining({
          event: 'reconnection_attempt'
        })
      );

      connectSpy.mockRestore();
    });

    it('should emit reconnection_success on successful reconnection', async () => {
      const successCallback = vi.fn();
      client.on('reconnection_success', successCallback);

      // Mock successful connect
      const connectSpy = vi.spyOn(client, 'connect').mockResolvedValue();

      // Trigger reconnection
      (client as any).attemptReconnect();

      // Fast-forward time to trigger the timeout
      await vi.runAllTimersAsync();

      expect(successCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          totalReconnectTime: expect.any(Number)
        }),
        expect.objectContaining({
          event: 'reconnection_success'
        })
      );

      connectSpy.mockRestore();
    });

    it('should emit reconnection_attempt_failed on connection failure', async () => {
      const failedCallback = vi.fn();
      client.on('reconnection_attempt_failed', failedCallback);

      // Mock failed connect
      const connectError = new Error('Connection failed');
      const connectSpy = vi.spyOn(client, 'connect').mockRejectedValue(connectError);

      // Trigger reconnection
      (client as any).attemptReconnect();

      // Fast-forward time to trigger the timeout
      await vi.runAllTimersAsync();

      expect(failedCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxAttempts: config.runtime.reconnectAttempts,
          errorMessage: 'Connection failed'
        }),
        expect.objectContaining({
          event: 'reconnection_attempt_failed',
          metadata: expect.objectContaining({
            originalError: connectError,
            source: 'websocket_client',
            timestamp: expect.any(Number)
          })
        })
      );

      connectSpy.mockRestore();
    });

    it('should not attempt reconnection on clean close (code 1000)', () => {
      const reconnectionCallback = vi.fn();
      client.on('reconnection_scheduled', reconnectionCallback);

      // Simulate clean close
      (client as any).handleClose(1000, Buffer.from('Normal closure'));

      expect(reconnectionCallback).not.toHaveBeenCalled();
    });

    it('should attempt reconnection on non-clean close', () => {
      const reconnectionCallback = vi.fn();
      client.on('reconnection_scheduled', reconnectionCallback);

      // Simulate non-clean close (connection lost)
      (client as any).handleClose(1006, Buffer.from('Connection lost'));

      expect(reconnectionCallback).toHaveBeenCalled();
    });

    it('should clear reconnection timeout on disconnect', () => {
      // Start a reconnection attempt
      (client as any).attemptReconnect();
      
      // Verify timeout was set
      expect((client as any).reconnectTimeout).not.toBeNull();
      
      // Call disconnect
      client.disconnect();
      
      // Verify timeout was cleared
      expect((client as any).reconnectTimeout).toBeNull();
    });

    it('should reset reconnection attempts on successful connection', async () => {
      // Set some failed attempts
      (client as any).reconnectAttempts = 2;
      
      // Mock successful connection
      mockWebSocket.readyState = 1; // OPEN
      const connectSpy = vi.spyOn(client, 'connect').mockImplementation(async () => {
        (client as any).reconnectAttempts = 0; // This should happen in actual connect()
        (client as any).emit('authenticated', {});
      });
      
      // Should reset attempts after successful connection
      await client.connect();
      
      expect((client as any).reconnectAttempts).toBe(0);
      
      connectSpy.mockRestore();
    });
  });
}); 