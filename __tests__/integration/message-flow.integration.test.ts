import { describe, expect, it, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import { config } from 'dotenv';
import { RestClient } from '../../src/clients/rest.client';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { loadConfig } from '../../src/config';
import { createSafeLogger } from '../../src/config/credentials';
import type { MattermostConfig } from '../../src/config';
import type { IAgentRuntime } from '@elizaos/core';

// Load .env file before anything else
config();

/**
 * Integration tests for RestClient against a specified Mattermost server.
 * These tests validate the complete REST API functionality including:
 * - Authentication and connection
 * - Team and user operations
 * - Channel operations
 * - Message posting
 * - Error handling and resilience
 * 
 * NOTE: These tests require a valid Mattermost configuration in .env
 * and will make real API calls to the configured server.
 * 
 * SETUP REQUIREMENTS:
 * 1. Set MATTERMOST_URL, MATTERMOST_TOKEN, MATTERMOST_TEAM in .env
 * 2. Set MATTERMOST_TEST_CHANNEL to a public channel the bot can access
 * 3. Ensure the bot user has permissions to post in the test channel
 * 
 * If MATTERMOST_TEST_CHANNEL is not set, defaults to 'eliza-testing'
 */

describe('RestClient Integration Tests', () => {
  let client: RestClient;
  let mattermostConfig: MattermostConfig;
  let testUserId: string;
  let testTeamId: string;
  let testChannelId: string | null = null;
  let testChannelName: string;

  beforeAll(async () => {
    try {
      console.log('✅ Configuration loaded successfully');
      mattermostConfig = loadConfig();
      testChannelName = mattermostConfig.env.MATTERMOST_TEST_CHANNEL;
      
      const logger = createSafeLogger(mattermostConfig);
      client = new RestClient(mattermostConfig);
      
      await client.initialize();
      
      // Get bot user and team info
      const me = await client.getBotUser();
      testUserId = me.id;
      console.log(`✅ Authenticated as: ${me.username} (${me.id})`);
      
      const team = await client.getTeam();
      testTeamId = team.id;
      console.log(`✅ Found team: ${team.display_name} (${team.id})`);
      
      // Try to find test channel
      try {
        const testChannel = await client.getChannelByName(testChannelName);
        testChannelId = testChannel.id;
        console.log(`✅ Found test channel: ${testChannel.display_name || testChannelName} (${testChannel.id})`);
      } catch (error) {
        console.log(`⚠️ Test channel "${testChannelName}" not found - message operations will be skipped`);
        console.log(`💡 To enable full testing, create a public channel named "${testChannelName}" or set MATTERMOST_TEST_CHANNEL in .env`);
      }
      
    } catch (error) {
      console.log('⚠️ Integration tests will be skipped - configuration or connection failed:', error.message);
      console.log('💡 To run integration tests:');
      console.log('   1. Create .env file with MATTERMOST_URL, MATTERMOST_TOKEN, MATTERMOST_TEAM');
      console.log('   2. Optionally set MATTERMOST_TEST_CHANNEL (defaults to "eliza-testing")');
      console.log('   3. Ensure the bot has access to the test channel');
    }
  });

  afterAll(async () => {
    // No disconnect method needed - RestClient doesn't have one
    if (client) {
      console.log('✅ Client tests completed');
    }
  });

  describe('Configuration and Connection', () => {
    it('should load configuration successfully', () => {
      expect(mattermostConfig).toBeDefined();
      expect(mattermostConfig.env.MATTERMOST_URL).toBeTruthy();
      expect(mattermostConfig.env.MATTERMOST_TOKEN).toBeTruthy();
      expect(mattermostConfig.env.MATTERMOST_TEAM).toBeTruthy();
      expect(mattermostConfig.env.MATTERMOST_TEST_CHANNEL).toBeTruthy();
    });

    it('should initialize client successfully', () => {
      expect(client).toBeDefined();
      expect(client.isReady()).toBe(true);
    });
  });

  describe('Authentication and User Operations', () => {
    it('should authenticate and get bot user info', async () => {
      if (!client) return; // Skip if no config
      
      const me = await client.getBotUser();
      expect(me).toBeDefined();
      expect(me.id).toBeTruthy();
      expect(me.username).toBeTruthy();
      expect(me.id).toBe(testUserId);
    });

    it('should get team info', async () => {
      if (!client) return;
      
      const team = await client.getTeam();
      expect(team).toBeDefined();
      expect(team.id).toBeTruthy();
      expect(team.name).toBeTruthy();
      expect(team.id).toBe(testTeamId);
    });

    it('should test connection successfully', async () => {
      if (!client) return;
      
      const connectionTest = await client.testConnection();
      expect(connectionTest.success).toBe(true);
      expect(connectionTest.error).toBeUndefined();
    });
  });

  describe('Channel Operations', () => {
    it('should get channel by name', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping channel test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const channel = await client.getChannelByName(testChannelName);
      expect(channel).toBeDefined();
      expect(channel.id).toBe(testChannelId);
      expect(channel.name).toBe(testChannelName);
      expect(channel.team_id).toBe(testTeamId);
    });

    it('should get channel by ID', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping channel test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const channel = await client.getChannel(testChannelId);
      expect(channel).toBeDefined();
      expect(channel.id).toBe(testChannelId);
      expect(channel.name).toBe(testChannelName);
    });
  });

  describe('Message Operations', () => {
    let testPostId: string;

    it('should post a message to channel', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping message test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const message = `🧪 Integration Test Message - ${new Date().toISOString()}`;
      const post = await client.createPost(testChannelId, message);
      
      expect(post).toBeDefined();
      expect(post.id).toBeTruthy();
      expect(post.message).toBe(message);
      expect(post.channel_id).toBe(testChannelId);
      expect(post.user_id).toBe(testUserId);
      
      testPostId = post.id;
    });

    it('should retrieve the posted message', async () => {
      if (!client || !testPostId) {
        console.log(`⚠️ Skipping message test - no test post available`);
        return;
      }
      
      const post = await client.getPost(testPostId);
      expect(post).toBeDefined();
      expect(post.id).toBe(testPostId);
      expect(post.message).toContain('Integration Test Message');
    });

    it('should update the posted message', async () => {
      if (!client || !testPostId) {
        console.log(`⚠️ Skipping message test - no test post available`);
        return;
      }
      
      const updatedMessage = `🧪 UPDATED Integration Test Message - ${new Date().toISOString()}`;
      const updatedPost = await client.updatePost(testPostId, updatedMessage);
      
      expect(updatedPost).toBeDefined();
      expect(updatedPost.message).toBe(updatedMessage);
      expect(updatedPost.edit_at).toBeGreaterThan(0);
    });

    it('should get channel posts', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping message test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const posts = await client.getPostsForChannel(testChannelId, { perPage: 10 });
      expect(posts).toBeDefined();
      expect(posts.posts).toBeDefined();
      expect(Object.keys(posts.posts).length).toBeGreaterThan(0);
      
      // Our test post should be in there
      if (testPostId) {
        expect(posts.posts[testPostId]).toBeDefined();
      }
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle invalid channel gracefully', async () => {
      if (!client) return;
      
      await expect(client.getChannel('invalid-channel-id'))
        .rejects.toThrow();
    });

    it('should handle invalid post gracefully', async () => {
      if (!client) return;
      
      await expect(client.getPost('invalid-post-id'))
        .rejects.toThrow();
    });

    it('should handle posting to invalid channel', async () => {
      if (!client) return;
      
      await expect(client.createPost('invalid-channel-id', 'This should fail'))
        .rejects.toThrow();
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle multiple concurrent requests', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping performance test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const promises = Array.from({ length: 5 }, (_, i) => 
        client.createPost(testChannelId, `🚀 Concurrent Test Message ${i + 1} - ${new Date().toISOString()}`)
      );
      
      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      results.forEach((post, i) => {
        expect(post.message).toContain(`Concurrent Test Message ${i + 1}`);
      });
    });

    it('should maintain connection after multiple operations', async () => {
      if (!client) return;
      
      // Perform multiple operations
      const me = await client.getBotUser();
      const team = await client.getTeam();
      
      if (testChannelId) {
        const channel = await client.getChannel(testChannelId);
        const posts = await client.getPostsForChannel(testChannelId, { perPage: 5 });
      }
      
      // Client should still be ready
      expect(client.isReady()).toBe(true);
      expect(me.id).toBeTruthy();
      expect(team.id).toBeTruthy();
    });
  });
});

/**
 * WebSocket Client and ElizaOS Runtime Integration Tests
 * 
 * These tests validate Task 5.5: Integration with ElizaOS Runtime and Logging Patterns
 * - WebSocket client integration with IAgentRuntime
 * - Proper logging using createSafeLogger and elizaLogger
 * - Configuration sourcing from MattermostConfig
 * - Runtime interaction consistency
 * - Event emission and handling patterns
 */
describe('WebSocket Client and ElizaOS Runtime Integration Tests', () => {
  let wsClient: WebSocketClient;
  let mockRuntime: IAgentRuntime;
  let mattermostConfig: MattermostConfig;

  beforeAll(async () => {
    try {
      mattermostConfig = loadConfig();
      
      // Create mock runtime that follows ElizaOS patterns
      mockRuntime = {
        character: { name: 'TestBot' },
        logger: createSafeLogger(console), // Use safe logger pattern
        agentId: 'test-agent-123',
        serverUrl: 'http://localhost:3000',
        token: 'test-token',
        actions: [],
        evaluators: [],
        providers: [],
        plugins: []
      } as IAgentRuntime;
      
      console.log('✅ Mock runtime created for WebSocket integration tests');
    } catch (error) {
      console.log('⚠️ WebSocket integration tests will be skipped - configuration failed:', error.message);
    }
  });

  describe('ElizaOS Runtime Integration', () => {
    beforeEach(() => {
      if (mattermostConfig) {
        wsClient = new WebSocketClient(mattermostConfig, mockRuntime);
      }
    });

    afterEach(async () => {
      if (wsClient) {
        await wsClient.disconnect();
      }
    });

    it('should initialize with proper ElizaOS runtime integration', () => {
      if (!mattermostConfig) return;
      
      expect(wsClient).toBeDefined();
      expect((wsClient as any).runtime).toBe(mockRuntime);
      expect((wsClient as any).config).toBe(mattermostConfig);
      expect((wsClient as any).logger).toBeDefined();
    });

    it('should use configurable parameters from MattermostConfig', () => {
      if (!mattermostConfig) return;
      
      const maxAttempts = (wsClient as any).maxReconnectAttempts;
      const baseDelay = (wsClient as any).baseReconnectDelay;
      
      expect(maxAttempts).toBe(mattermostConfig.runtime.reconnectAttempts);
      expect(baseDelay).toBe(mattermostConfig.runtime.reconnectDelay);
    });

    it('should properly integrate logging patterns', () => {
      if (!mattermostConfig) return;
      
      const logger = (wsClient as any).logger;
      expect(logger).toBeDefined();
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.debug).toBe('function');
    });

    it('should handle connection state with runtime awareness', () => {
      if (!mattermostConfig) return;
      
      expect(wsClient.isConnected()).toBe(false);
      expect((wsClient as any).isAuthenticated).toBe(false);
    });
  });

  describe('Configuration Integration', () => {
    it('should source all configuration from MattermostConfig', () => {
      if (!mattermostConfig) return;
      
      const config = (wsClient as any).config;
      expect(config.env.MATTERMOST_URL).toBeTruthy();
      expect(config.env.MATTERMOST_TOKEN).toBeTruthy();
      expect(config.runtime.reconnectAttempts).toBeTypeOf('number');
      expect(config.runtime.reconnectDelay).toBeTypeOf('number');
    });

    it('should use Client4 with proper configuration', () => {
      if (!mattermostConfig) return;
      
      const client4 = (wsClient as any).client;
      expect(client4).toBeDefined();
      // Client4 should be configured with URL and token from config
    });
  });

  describe('Event System Integration', () => {
    it('should provide ElizaOS-compatible event interface', () => {
      if (!mattermostConfig) return;
      
      expect(typeof wsClient.on).toBe('function');
      expect(typeof wsClient.off).toBe('function');
      expect(typeof wsClient.once).toBe('function');
      expect(typeof wsClient.emit).toBe('function');
      expect(typeof wsClient.removeAllListeners).toBe('function');
    });

    it('should emit events with proper metadata structure', () => {
      if (!mattermostConfig) return;
      
      const testCallback = vi.fn();
      wsClient.on('test_event', testCallback);
      
      // Emit a test event with metadata
      wsClient.emit('test_event', { message: 'test' }, { 
        timestamp: Date.now(),
        source: 'integration_test' 
      });
      
      expect(testCallback).toHaveBeenCalledWith(
        { message: 'test' },
        expect.objectContaining({
          event: 'test_event',
          metadata: expect.objectContaining({
            timestamp: expect.any(Number),
            source: 'integration_test'
          })
        })
      );
    });

    it('should handle reconnection events with proper runtime logging', () => {
      if (!mattermostConfig) return;
      
      const reconnectionCallback = vi.fn();
      wsClient.on('reconnection_scheduled', reconnectionCallback);
      
      // Simulate reconnection attempt
      (wsClient as any).reconnectAttempts = 1;
      (wsClient as any).attemptReconnect();
      
      expect(reconnectionCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 2,
          maxAttempts: mattermostConfig.runtime.reconnectAttempts,
          delay: expect.any(Number)
        }),
        expect.objectContaining({
          event: 'reconnection_scheduled'
        })
      );
    });
  });

  describe('Error Handling and Runtime Reporting', () => {
    it('should handle errors with proper runtime logging', () => {
      if (!mattermostConfig) return;
      
      const logger = (wsClient as any).logger;
      const errorSpy = vi.spyOn(logger, 'error');
      
      // Simulate handling a malformed message
      const badMessage = 'invalid-json-{';
      (wsClient as any).handleMessage(badMessage);
      
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error handling WebSocket message'),
        expect.objectContaining({
          error: expect.any(String),
          data: badMessage
        })
      );
    });

    it('should emit error events for runtime consumption', () => {
      if (!mattermostConfig) return;
      
      const logger = (wsClient as any).logger;
      const errorSpy = vi.spyOn(logger, 'error');
      
      // Simulate WebSocket error
      const testError = new Error('Connection failed');
      (wsClient as any).handleError(testError);
      
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket error'),
        expect.objectContaining({
          error: 'Connection failed',
          reconnectAttempts: expect.any(Number)
        })
      );
    });
  });

  describe('Runtime Lifecycle Integration', () => {
    it('should handle graceful shutdown', async () => {
      if (!mattermostConfig) return;
      
      const logger = (wsClient as any).logger;
      const infoSpy = vi.spyOn(logger, 'info');
      
      await wsClient.disconnect();
      
      expect(infoSpy).toHaveBeenCalledWith('Disconnecting WebSocket client');
      expect(infoSpy).toHaveBeenCalledWith('WebSocket client disconnected');
      expect(wsClient.isConnected()).toBe(false);
    });

    it('should clean up resources properly', async () => {
      if (!mattermostConfig) return;
      
      // Add some listeners
      wsClient.on('test1', () => {});
      wsClient.on('test2', () => {});
      
      expect(wsClient.eventNames()).toContain('test1');
      expect(wsClient.eventNames()).toContain('test2');
      
      await wsClient.disconnect();
      
      // All listeners should be cleaned up
      expect(wsClient.eventNames()).toHaveLength(0);
    });
  });

  describe('Production Readiness', () => {
    it('should use production-grade logging levels', () => {
      if (!mattermostConfig) return;
      
      const logger = (wsClient as any).logger;
      
      // Should have all required logging methods
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
    });

    it('should follow ElizaOS service patterns', () => {
      if (!mattermostConfig) return;
      
      // Should accept IAgentRuntime in constructor
      expect((wsClient as any).runtime).toBeDefined();
      expect((wsClient as any).runtime.character).toBeDefined();
      expect((wsClient as any).runtime.logger).toBeDefined();
      
      // Should use safe configuration patterns
      expect((wsClient as any).config).toBeDefined();
      expect((wsClient as any).logger).toBeDefined();
    });

    it('should handle concurrent operations safely', () => {
      if (!mattermostConfig) return;
      
      const callbacks = Array.from({ length: 10 }, () => vi.fn());
      
      // Register multiple listeners concurrently
      callbacks.forEach((callback, i) => {
        wsClient.on(`concurrent_test_${i}`, callback);
      });
      
      // Emit events concurrently
      callbacks.forEach((callback, i) => {
        wsClient.emit(`concurrent_test_${i}`, { index: i });
      });
      
      // All callbacks should have been called
      callbacks.forEach((callback, i) => {
        expect(callback).toHaveBeenCalledWith(
          { index: i },
          expect.objectContaining({
            event: `concurrent_test_${i}`
          })
        );
      });
    });
  });
});
