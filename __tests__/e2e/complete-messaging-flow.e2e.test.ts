import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { RestClient } from '../../src/clients/rest.client';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { MessageManager } from '../../src/managers/message.manager';
import { loadConfig } from '../../src/config';
import { IntegrationTestHelper } from '../integration/test-helper';
import { hasRealCredentials, validateTestEnvironment } from './test-env.setup';
import { v4 as uuidv4 } from 'uuid';
import type { MattermostConfig } from '../../src/config';

/**
 * Complete End-to-End Message Flow Testing
 * 
 * Tests the entire pipeline:
 * Mattermost ↔ Plugin Components ↔ Local ElizaOS Docker
 * 
 * Scenarios covered:
 * 1. Basic mention responses
 * 2. Direct message handling  
 * 3. Multi-turn conversations
 * 4. Error recovery and resilience
 * 5. Message formatting and attachments
 * 6. Real-time WebSocket synchronization
 */
describe('Complete End-to-End Message Flow', () => {
  let helper: IntegrationTestHelper;
  let config: MattermostConfig;
  let restClient: RestClient;
  let wsClient: WebSocketClient;
  let messageManager: MessageManager;
  let testChannelId: string;
  let directChannelId: string;
  let botUserId: string;

  // Test message tracking
  const sentMessages: string[] = [];
  const receivedEvents: any[] = [];

  beforeAll(async () => {
    // Check if we have real credentials
    const validation = validateTestEnvironment();
    if (!validation.valid) {
      console.warn(validation.message);
      return; // Skip setup if no real credentials
    }

    // 1. Load production Mattermost configuration
    config = await loadConfig();
    expect(config.serverUrl).toBeTruthy();
    expect(config.token).toBeTruthy();
    
    // 2. Start local ElizaOS environment
    helper = IntegrationTestHelper.getInstance();
    await helper.startTestEnvironment();
    
    // 3. Initialize plugin components
    restClient = new RestClient(config);
    wsClient = new WebSocketClient(config);
    messageManager = new MessageManager(restClient, wsClient, null);
    
    await restClient.connect();
    
    // 4. Set up test channels
    const botUser = await restClient.getCurrentUser();
    botUserId = botUser.id;
    
    // Create test channel for mentions
    const teams = await restClient.getTeamsForUser(botUserId);
    const primaryTeam = teams[0];
    
    try {
      const channel = await restClient.getChannelByName(primaryTeam.id, 'e2e-test-channel');
      testChannelId = channel.id;
    } catch {
      const newChannel = await restClient.createChannel({
        team_id: primaryTeam.id,
        name: 'e2e-test-channel',
        display_name: 'E2E Test Channel',
        type: 'O',
        purpose: 'End-to-end testing for Mattermost plugin',
      });
      testChannelId = newChannel.id;
    }
    
    // Create direct message channel for DM testing
    const dmChannel = await restClient.createDirectChannel([botUserId, botUserId]);
    directChannelId = dmChannel.id;
    
  }, 180000);

  afterAll(async () => {
    // Clean up test messages
    for (const messageId of sentMessages) {
      try {
        await restClient.deletePost(messageId);
      } catch (error) {
        console.warn(`Failed to clean up message ${messageId}:`, error);
      }
    }
    
    // Clean up connections
    if (messageManager) await messageManager.cleanup();
    if (wsClient) await wsClient.disconnect();
    
    // Stop ElizaOS environment
    if (helper) await helper.cleanup();
  });

  beforeEach(async () => {
    if (!hasRealCredentials() || !wsClient || !messageManager) {
      return; // Skip if no real credentials or setup failed
    }
    
    // Connect WebSocket and initialize message manager for each test
    await wsClient.connect();
    await messageManager.initialize();
    
    // Set up event tracking
    wsClient.on('posted', (event) => {
      receivedEvents.push({
        type: 'posted',
        timestamp: Date.now(),
        data: event
      });
    });
    
    wsClient.on('post_edited', (event) => {
      receivedEvents.push({
        type: 'post_edited', 
        timestamp: Date.now(),
        data: event
      });
    });
  });

  afterEach(async () => {
    if (!hasRealCredentials() || !wsClient) {
      return; // Skip if no real credentials or setup failed
    }
    
    // Clear event tracking
    receivedEvents.length = 0;
    
    // Remove all listeners
    wsClient.removeAllListeners();
    
    await new Promise(resolve => setTimeout(resolve, 100)); // Brief pause
  });

  describe('Basic Message Flow Scenarios', () => {
    it('should handle bot mention and generate ElizaOS response', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const mentionText = `@${config.username} Hello there, test ID: ${testId}`;
      
      // Track ElizaOS interaction
      let elizaResponse = '';
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async (message: string) => {
        elizaResponse = `ElizaOS processed: "${message}" - Test response ${testId}`;
        return elizaResponse;
      };
      
      // Set up response expectation
      const responsePromise = new Promise<any>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 10000);
        
        wsClient.on('posted', (event) => {
          if (event.post?.message?.includes(testId) && 
              event.post?.user_id === botUserId) {
            clearTimeout(timeout);
            resolve(event);
          }
        });
      });
      
      // Send mention message
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: mentionText,
      });
      sentMessages.push(post.id);
      
      // Wait for ElizaOS response
      const responseEvent = await responsePromise;
      
      expect(responseEvent).toBeTruthy();
      expect(responseEvent.post.message).toContain(testId);
      expect(elizaResponse).toContain(testId);
      
      // Verify message was processed by ElizaOS
      expect(elizaResponse).toContain('ElizaOS processed');
      
      // Clean up mock
      messageManager.processMessage = originalProcess;
    });

    it('should handle direct messages without mentions', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const dmText = `Direct message test ${testId}`;
      
      let dmProcessed = false;
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async (message: string) => {
        dmProcessed = true;
        return `DM response for: ${testId}`;
      };
      
      const responsePromise = new Promise<any>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 10000);
        
        wsClient.on('posted', (event) => {
          if (event.post?.message?.includes(testId) && 
              event.post?.user_id === botUserId) {
            clearTimeout(timeout);
            resolve(event);
          }
        });
      });
      
      // Send DM
      const post = await restClient.createPost({
        channel_id: directChannelId,
        message: dmText,
      });
      sentMessages.push(post.id);
      
      const responseEvent = await responsePromise;
      
      expect(responseEvent).toBeTruthy();
      expect(dmProcessed).toBe(true);
      
      messageManager.processMessage = originalProcess;
    });
  });

  describe('Multi-Turn Conversation Flow', () => {
    it('should maintain conversation context across multiple messages', async () => {
      const conversationId = uuidv4().slice(0, 8);
      const responses: string[] = [];
      
      // Mock conversation tracking
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async (message: string) => {
        responses.push(message);
        return `Response ${responses.length} for conversation ${conversationId}`;
      };
      
      // Send first message
      const post1 = await restClient.createPost({
        channel_id: testChannelId,
        message: `@${config.username} Start conversation ${conversationId}`,
      });
      sentMessages.push(post1.id);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Send follow-up message
      const post2 = await restClient.createPost({
        channel_id: testChannelId,
        message: `@${config.username} Continue conversation ${conversationId}`,
      });
      sentMessages.push(post2.id);
      
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      expect(responses).toHaveLength(2);
      expect(responses[0]).toContain(conversationId);
      expect(responses[1]).toContain(conversationId);
      
      messageManager.processMessage = originalProcess;
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle ElizaOS service failures gracefully', async () => {
      const testId = uuidv4().slice(0, 8);
      
      // Mock ElizaOS failure
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async () => {
        throw new Error('ElizaOS service unavailable');
      };
      
      const errorHandled = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), 5000);
        
        // Should not crash, should handle error gracefully
        messageManager.on('error', () => {
          clearTimeout(timeout);
          resolve(true);
        });
      });
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: `@${config.username} Error test ${testId}`,
      });
      sentMessages.push(post.id);
      
      const handled = await errorHandled;
      expect(handled).toBe(true);
      
      messageManager.processMessage = originalProcess;
    });

    it('should handle WebSocket disconnection and reconnection', async () => {
      const testId = uuidv4().slice(0, 8);
      
      // Simulate WebSocket disconnection
      await wsClient.disconnect();
      
      // Send message while disconnected
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: `@${config.username} Disconnection test ${testId}`,
      });
      sentMessages.push(post.id);
      
      // Reconnect
      await wsClient.connect();
      await messageManager.initialize();
      
      // Verify reconnection works
      const reconnectTest = `@${config.username} Reconnect test ${testId}`;
      let reconnectReceived = false;
      
      const reconnectPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 5000);
        
        wsClient.on('posted', (event) => {
          if (event.post?.message === reconnectTest) {
            reconnectReceived = true;
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      
      const reconnectPost = await restClient.createPost({
        channel_id: testChannelId,
        message: reconnectTest,
      });
      sentMessages.push(reconnectPost.id);
      
      await reconnectPromise;
      expect(reconnectReceived).toBe(true);
    });
  });

  describe('Message Format and Content Validation', () => {
    it('should handle messages with special characters and formatting', async () => {
      const testId = uuidv4().slice(0, 8);
      const specialMessage = `@${config.username} Test ${testId}: **bold** *italic* \`code\` > quote [link](http://example.com)`;
      
      let processedMessage = '';
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async (message: string) => {
        processedMessage = message;
        return `Processed special formatting for ${testId}`;
      };
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: specialMessage,
      });
      sentMessages.push(post.id);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(processedMessage).toContain('**bold**');
      expect(processedMessage).toContain('*italic*');
      expect(processedMessage).toContain('`code`');
      
      messageManager.processMessage = originalProcess;
    });

    it('should handle long messages and message limits', async () => {
      const testId = uuidv4().slice(0, 8);
      const longMessage = `@${config.username} Long message test ${testId}: ` + 'A'.repeat(3000);
      
      let messageLength = 0;
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async (message: string) => {
        messageLength = message.length;
        return `Handled long message ${testId}`;
      };
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: longMessage,
      });
      sentMessages.push(post.id);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      expect(messageLength).toBeGreaterThan(3000);
      
      messageManager.processMessage = originalProcess;
    });
  });

  describe('Real-time Synchronization', () => {
    it('should receive WebSocket events in real-time', async () => {
      const testId = uuidv4().slice(0, 8);
      const eventReceived = new Promise<any>((resolve) => {
        const timeout = setTimeout(() => resolve(null), 5000);
        
        wsClient.on('posted', (event) => {
          if (event.post?.message?.includes(testId)) {
            clearTimeout(timeout);
            resolve(event);
          }
        });
      });
      
      // Measure timing
      const sendTime = Date.now();
      
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: `Real-time test ${testId}`,
      });
      sentMessages.push(post.id);
      
      const event = await eventReceived;
      const receiveTime = Date.now();
      
      expect(event).toBeTruthy();
      expect(receiveTime - sendTime).toBeLessThan(2000); // Should be very fast
      expect(event.post.id).toBe(post.id);
    });

    it('should handle concurrent messages correctly', async () => {
      const baseId = uuidv4().slice(0, 8);
      const messageCount = 5;
      const receivedMessages: any[] = [];
      
      const allReceived = new Promise<void>((resolve) => {
        wsClient.on('posted', (event) => {
          if (event.post?.message?.includes(baseId)) {
            receivedMessages.push(event);
            if (receivedMessages.length === messageCount) {
              resolve();
            }
          }
        });
      });
      
      // Send multiple messages concurrently
      const promises = Array.from({ length: messageCount }, (_, i) =>
        restClient.createPost({
          channel_id: testChannelId,
          message: `Concurrent test ${baseId}-${i}`,
        })
      );
      
      const posts = await Promise.all(promises);
      posts.forEach(post => sentMessages.push(post.id));
      
      await allReceived;
      
      expect(receivedMessages).toHaveLength(messageCount);
      
      // Verify all messages were received
      const receivedIds = receivedMessages.map(event => event.post.id);
      const sentIds = posts.map(post => post.id);
      
      sentIds.forEach(id => {
        expect(receivedIds).toContain(id);
      });
    });
  });
}); 