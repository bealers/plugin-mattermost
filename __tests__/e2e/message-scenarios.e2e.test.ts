/**
 * Message Scenarios End-to-End Tests
 * 
 * Tests real-world message flows using:
 * - Production Mattermost (chat.siftware.com)
 * - Local ElizaOS Docker container
 * - Actual plugin components
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RestClient } from '../../src/clients/rest.client';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { MessageManager } from '../../src/managers/message.manager';
import { loadConfig } from '../../src/config';
import { hasRealCredentials, validateTestEnvironment } from './test-env.setup';
import { v4 as uuidv4 } from 'uuid';
import type { MattermostConfig } from '../../src/config';

describe('Message Scenarios E2E', () => {
  let config: MattermostConfig;
  let restClient: RestClient;
  let wsClient: WebSocketClient;
  let messageManager: MessageManager;
  let testChannelId: string;
  let botUserId: string;

  const testMessages: string[] = [];

  beforeAll(async () => {
    // Check if we have real credentials
    const validation = validateTestEnvironment();
    if (!validation.valid) {
      console.warn(validation.message);
      return; // Skip setup if no real credentials
    }

    // Load real configuration
    config = await loadConfig();
    
    // Validate we have production credentials
    expect(config.serverUrl).toBe('https://chat.siftware.com');
    expect(config.token).toBeTruthy();
    expect(config.username).toBeTruthy();
    
    // Initialize components
    restClient = new RestClient(config);
    wsClient = new WebSocketClient(config);
    messageManager = new MessageManager(restClient, wsClient, null);
    
    await restClient.connect();
    
    // Get bot info and test channel
    const botUser = await restClient.getCurrentUser();
    botUserId = botUser.id;
    
    const teams = await restClient.getTeamsForUser(botUserId);
    const primaryTeam = teams[0];
    
    // Use existing channel or create test channel
    try {
      const channel = await restClient.getChannelByName(primaryTeam.id, 'plugin-test');
      testChannelId = channel.id;
    } catch {
      // Create test channel if needed
      const newChannel = await restClient.createChannel({
        team_id: primaryTeam.id,
        name: 'plugin-test',
        display_name: 'Plugin Test',
        type: 'O',
        purpose: 'Testing Mattermost plugin functionality',
      });
      testChannelId = newChannel.id;
    }
  }, 30000);

  afterAll(async () => {
    // Clean up test messages
    for (const messageId of testMessages) {
      try {
        await restClient.deletePost(messageId);
      } catch (error) {
        console.warn(`Could not delete test message ${messageId}:`, error);
      }
    }
    
    // Clean up connections
    if (messageManager) await messageManager.cleanup();
    if (wsClient) await wsClient.disconnect();
  });

  beforeEach(async () => {
    if (!hasRealCredentials() || !wsClient || !messageManager) {
      return; // Skip if no real credentials or setup failed
    }
    
    // Connect WebSocket for each test
    await wsClient.connect();
    await messageManager.initialize();
  });

  describe('Basic Message Posting', () => {
    it('should successfully post a message to test channel', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const message = `Test message ${testId} - E2E validation`;
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: message,
      });
      
      testMessages.push(post.id);
      
      expect(post).toBeTruthy();
      expect(post.message).toBe(message);
      expect(post.channel_id).toBe(testChannelId);
      expect(post.user_id).toBe(botUserId);
    });

    it('should post message with bot mention', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const message = `@${config.username} Test mention ${testId}`;
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: message,
      });
      
      testMessages.push(post.id);
      
      expect(post.message).toBe(message);
      expect(post.message).toContain(`@${config.username}`);
    });
  });

  describe('WebSocket Message Reception', () => {
    it('should receive WebSocket event when message is posted', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const message = `WebSocket test ${testId}`;
      
      // Set up WebSocket listener
      const messagePromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);
        
        wsClient.on('posted', (event) => {
          if (event.post?.message === message) {
            clearTimeout(timeout);
            resolve(event);
          }
        });
      });
      
      // Post message
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: message,
      });
      
      testMessages.push(post.id);
      
      // Wait for WebSocket event
      const receivedEvent = await messagePromise;
      
      expect(receivedEvent).toBeTruthy();
      expect((receivedEvent as any).post.id).toBe(post.id);
      expect((receivedEvent as any).post.message).toBe(message);
    });

    it('should handle multiple concurrent messages', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const baseId = uuidv4().slice(0, 8);
      const messageCount = 3;
      const receivedEvents: any[] = [];
      
      // Set up WebSocket listener for multiple messages
      const allMessagesPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 10000);
        
        wsClient.on('posted', (event) => {
          if (event.post?.message?.includes(baseId)) {
            receivedEvents.push(event);
            if (receivedEvents.length === messageCount) {
              clearTimeout(timeout);
              resolve();
            }
          }
        });
      });
      
      // Send multiple messages
      const posts = await Promise.all(
        Array.from({ length: messageCount }, (_, i) =>
          restClient.createPost({
            channel_id: testChannelId,
            message: `Concurrent test ${baseId}-${i}`,
          })
        )
      );
      
      posts.forEach(post => testMessages.push(post.id));
      
      await allMessagesPromise;
      
      expect(receivedEvents).toHaveLength(messageCount);
      
      // Verify all messages were received
      const receivedIds = receivedEvents.map(event => event.post.id);
      posts.forEach(post => {
        expect(receivedIds).toContain(post.id);
      });
    });
  });

  describe('Message Manager Integration', () => {
    it('should detect mentions in message manager', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const message = `@${config.username} Message manager test ${testId}`;
      
      let mentionDetected = false;
      const originalDetect = messageManager.detectMention;
      messageManager.detectMention = (messageText: string, username: string) => {
        mentionDetected = true;
        return originalDetect.call(messageManager, messageText, username);
      };
      
      const responsePromise = new Promise<any>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);
        
        wsClient.on('posted', (event) => {
          if (event.post?.message?.includes(testId) && 
              event.post?.user_id === botUserId) {
            clearTimeout(timeout);
            resolve(event);
          }
        });
      });
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: message,
      });
      
      testMessages.push(post.id);
      
      // Simulate message processing through MessageManager
      await messageManager.handleMessage(post);
      
      expect(mentionDetected).toBe(true);
      
      // Clean up mock
      messageManager.detectMention = originalDetect;
    });

    it('should handle message processing errors gracefully', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const message = `@${config.username} Error test ${testId}`;
      
      let errorHandled = false;
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async () => {
        throw new Error('Simulated processing error');
      };
      
      const originalHandle = messageManager.handleError;
      messageManager.handleError = (error: Error) => {
        errorHandled = true;
        originalHandle.call(messageManager, error);
      };
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: message,
      });
      
      testMessages.push(post.id);
      
      // This should handle the error gracefully
      await messageManager.handleMessage(post);
      
      expect(errorHandled).toBe(true);
      
      // Clean up mocks
      messageManager.processMessage = originalProcess;
      messageManager.handleError = originalHandle;
    });
  });

  describe('Connection Resilience', () => {
    it('should reconnect WebSocket after disconnection', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      // Disconnect WebSocket
      await wsClient.disconnect();
      
      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Reconnect
      await wsClient.connect();
      
      // Test that connection works again
      const testId = uuidv4().slice(0, 8);
      const message = `Reconnection test ${testId}`;
      
      const messagePromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);
        
        wsClient.on('posted', (event) => {
          if (event.post?.message === message) {
            clearTimeout(timeout);
            resolve(event);
          }
        });
      });
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: message,
      });
      
      testMessages.push(post.id);
      
      const receivedEvent = await messagePromise;
      expect(receivedEvent).toBeTruthy();
    });
  });

  describe('Message Format Handling', () => {
    it('should handle messages with markdown formatting', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const message = `@${config.username} **Bold** *italic* \`code\` test ${testId}`;
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: message,
      });
      
      testMessages.push(post.id);
      
      expect(post.message).toBe(message);
      expect(post.message).toContain('**Bold**');
      expect(post.message).toContain('*italic*');
      expect(post.message).toContain('`code`');
    });

    it('should handle long messages', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const longContent = 'A'.repeat(2000);
      const message = `@${config.username} Long message test ${testId}: ${longContent}`;
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: message,
      });
      
      testMessages.push(post.id);
      
      expect(post.message).toBe(message);
      expect(post.message.length).toBeGreaterThan(2000);
    });
  });
}); 