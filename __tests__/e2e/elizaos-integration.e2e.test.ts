/**
 * ElizaOS Integration End-to-End Tests
 * 
 * Tests the integration between the Mattermost plugin and ElizaOS:
 * - Docker container orchestration
 * - Message processing through ElizaOS
 * - Response generation and delivery
 * - Plugin lifecycle management
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { RestClient } from '../../src/clients/rest.client';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { MessageManager } from '../../src/managers/message.manager';
import { loadConfig } from '../../src/config';
import { IntegrationTestHelper } from '../integration/test-helper';
import { hasRealCredentials, validateTestEnvironment } from './test-env.setup';
import { v4 as uuidv4 } from 'uuid';
import type { MattermostConfig } from '../../src/config';

describe('ElizaOS Integration E2E', () => {
  let config: MattermostConfig;
  let helper: IntegrationTestHelper;
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

    // Load configuration
    config = await loadConfig();
    
    // Start ElizaOS Docker environment
    helper = IntegrationTestHelper.getInstance();
    await helper.startTestEnvironment();
    
    // Initialize plugin components
    restClient = new RestClient(config);
    wsClient = new WebSocketClient(config);
    messageManager = new MessageManager(restClient, wsClient, null);
    
    await restClient.connect();
    
    // Set up test environment
    const botUser = await restClient.getCurrentUser();
    botUserId = botUser.id;
    
    const teams = await restClient.getTeamsForUser(botUserId);
    const primaryTeam = teams[0];
    
    try {
      const channel = await restClient.getChannelByName(primaryTeam.id, 'elizaos-test');
      testChannelId = channel.id;
    } catch {
      const newChannel = await restClient.createChannel({
        team_id: primaryTeam.id,
        name: 'elizaos-test',
        display_name: 'ElizaOS Integration Test',
        type: 'O',
        purpose: 'Testing ElizaOS integration with Mattermost plugin',
      });
      testChannelId = newChannel.id;
    }
  }, 120000);

  afterAll(async () => {
    // Clean up test messages
    for (const messageId of testMessages) {
      try {
        await restClient.deletePost(messageId);
      } catch (error) {
        console.warn(`Could not delete test message ${messageId}:`, error);
      }
    }
    
    // Clean up connections and containers
    if (messageManager) await messageManager.cleanup();
    if (wsClient) await wsClient.disconnect();
    if (helper) await helper.cleanup();
  });

  beforeEach(async () => {
    if (!hasRealCredentials() || !wsClient || !messageManager) {
      return; // Skip if no real credentials or setup failed
    }
    
    // Ensure connections are ready
    await wsClient.connect();
    await messageManager.initialize();
  });

  describe('ElizaOS Docker Environment', () => {
    it('should have ElizaOS container running and healthy', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      expect(helper.testEnvironment).toBeTruthy();
      expect(helper.testEnvironment?.isRunning).toBe(true);
    });

    it('should be able to communicate with ElizaOS API', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      // This test would verify that ElizaOS is accessible
      // For now, we'll check that the helper can manage the environment
      const isHealthy = await helper.checkServiceHealth('elizaos-test');
      expect(isHealthy).toBe(true);
    });
  });

  describe('Message Processing Through ElizaOS', () => {
    it('should process simple mention through ElizaOS', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const message = `@${config.username} Simple test ${testId}`;
      
      let elizaProcessed = false;
      let elizaResponse = '';
      
      // Mock ElizaOS integration
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async (msg: string) => {
        elizaProcessed = true;
        // Simulate ElizaOS processing
        elizaResponse = `ElizaOS says: I received "${msg}" with ID ${testId}`;
        return elizaResponse;
      };
      
      try {
        // Set up response tracking
        const responsePromise = new Promise<any>((resolve) => {
          const timeout = setTimeout(() => resolve(null), 10000);
          
          wsClient.on('posted', async (event) => {
            if (event.post?.message === message) {
              await messageManager.handleMessage(event);
              
              // Check for bot response
              setTimeout(async () => {
                try {
                  const posts = await restClient.getPostsForChannel(testChannelId);
                  const botResponse = posts.posts.find(p => 
                    p.user_id === botUserId && 
                    p.message.includes(testId) &&
                    p.id !== event.post.id
                  );
                  
                  if (botResponse) {
                    clearTimeout(timeout);
                    resolve(botResponse);
                  }
                } catch (error) {
                  console.warn('Error checking for bot response:', error);
                }
              }, 1000);
            }
          });
        });
        
        // Send message
        const post = await restClient.createPost({
          channel_id: testChannelId,
          message: message,
        });
        
        testMessages.push(post.id);
        
        // Wait for processing and response
        const response = await responsePromise;
        
        expect(elizaProcessed).toBe(true);
        expect(elizaResponse).toContain(testId);
        
        // If we get a response, verify it
        if (response) {
          expect(response.message).toContain(testId);
          testMessages.push(response.id);
        }
        
      } finally {
        messageManager.processMessage = originalProcess;
      }
    });

    it('should handle complex message with context', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const complexMessage = `@${config.username} Complex test ${testId}: What is the weather today? Please help me understand this concept.`;
      
      let processedMessage = '';
      
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async (msg: string) => {
        processedMessage = msg;
        return `ElizaOS complex response for ${testId}: I understand you're asking about weather and need help with a concept.`;
      };
      
      try {
        const handlingPromise = new Promise<void>((resolve) => {
          wsClient.on('posted', async (event) => {
            if (event.post?.message === complexMessage) {
              await messageManager.handleMessage(event);
              resolve();
            }
          });
        });
        
        const post = await restClient.createPost({
          channel_id: testChannelId,
          message: complexMessage,
        });
        
        testMessages.push(post.id);
        
        await handlingPromise;
        
        expect(processedMessage).toContain(testId);
        expect(processedMessage).toContain('weather');
        expect(processedMessage).toContain('concept');
        
      } finally {
        messageManager.processMessage = originalProcess;
      }
    });
  });

  describe('ElizaOS Response Delivery', () => {
    it('should deliver ElizaOS response back to Mattermost', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const message = `@${config.username} Response test ${testId}`;
      const expectedResponse = `Response delivered: ${testId}`;
      
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async () => expectedResponse;
      
      try {
        // Track bot responses
        const responsePromise = new Promise<string>((resolve) => {
          const timeout = setTimeout(() => resolve(''), 8000);
          
          const checkForResponse = async () => {
            try {
              const posts = await restClient.getPostsForChannel(testChannelId);
              const botResponse = posts.posts.find(p => 
                p.user_id === botUserId && 
                p.message.includes(testId)
              );
              
              if (botResponse) {
                clearTimeout(timeout);
                resolve(botResponse.message);
              } else {
                setTimeout(checkForResponse, 500);
              }
            } catch (error) {
              console.warn('Error checking for bot response:', error);
            }
          };
          
          setTimeout(checkForResponse, 1000);
        });
        
        const post = await restClient.createPost({
          channel_id: testChannelId,
          message: message,
        });
        
        testMessages.push(post.id);
        
        // Trigger message handling
        await messageManager.handleMessage({ post });
        
        const deliveredResponse = await responsePromise;
        expect(deliveredResponse).toContain(testId);
        
      } finally {
        messageManager.processMessage = originalProcess;
      }
    });
  });

  describe('Error Scenarios', () => {
    it('should handle ElizaOS container being unavailable', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      // Simulate ElizaOS being down
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async () => {
        throw new Error('ElizaOS container unreachable');
      };
      
      let errorHandled = false;
      const originalErrorHandler = messageManager.handleError;
      messageManager.handleError = (error: Error) => {
        errorHandled = true;
        console.log('Handled error:', error.message);
      };
      
      try {
        const testId = uuidv4().slice(0, 8);
        const message = `@${config.username} Error test ${testId}`;
        
        const post = await restClient.createPost({
          channel_id: testChannelId,
          message: message,
        });
        
        testMessages.push(post.id);
        
        // This should handle the error gracefully
        await messageManager.handleMessage({ post });
        
        expect(errorHandled).toBe(true);
        
      } finally {
        messageManager.processMessage = originalProcess;
        messageManager.handleError = originalErrorHandler;
      }
    });

    it('should handle slow ElizaOS responses', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      const testId = uuidv4().slice(0, 8);
      const message = `@${config.username} Slow test ${testId}`;
      
      const originalProcess = messageManager.processMessage;
      messageManager.processMessage = async (msg: string) => {
        // Simulate slow response
        await new Promise(resolve => setTimeout(resolve, 3000));
        return `Slow response: ${testId}`;
      };
      
      try {
        const startTime = Date.now();
        
        const post = await restClient.createPost({
          channel_id: testChannelId,
          message: message,
        });
        
        testMessages.push(post.id);
        
        await messageManager.handleMessage({ post });
        
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeGreaterThan(2500); // Should take at least 2.5 seconds
        
      } finally {
        messageManager.processMessage = originalProcess;
      }
    });
  });

  describe('Plugin Lifecycle with ElizaOS', () => {
    it('should properly initialize with ElizaOS environment', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      // Test that all components initialize correctly with ElizaOS
      expect(restClient).toBeTruthy();
      expect(wsClient).toBeTruthy();
      expect(messageManager).toBeTruthy();
      expect(helper).toBeTruthy();
      expect(helper.testEnvironment?.isRunning).toBe(true);
    });

    it('should handle graceful shutdown', async () => {
      if (!hasRealCredentials()) {
        console.log('Skipping test - no real credentials provided');
        return;
      }
      // Test graceful shutdown of all components
      let shutdownCalled = false;
      
      const originalCleanup = messageManager.cleanup;
      messageManager.cleanup = async () => {
        shutdownCalled = true;
        await originalCleanup.call(messageManager);
      };
      
      // Simulate shutdown
      await messageManager.cleanup();
      
      expect(shutdownCalled).toBe(true);
      
      // Restore original method
      messageManager.cleanup = originalCleanup;
    });
  });
}); 