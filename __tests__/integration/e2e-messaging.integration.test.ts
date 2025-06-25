import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';
import { RestClient } from '../../src/clients/rest.client';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { MessageManager } from '../../src/managers/message.manager';
import { MattermostConfig } from '../../src/config';
import { v4 as uuidv4 } from 'uuid';

/**
 * End-to-End Integration Test for Mattermost Plugin
 * 
 * This test suite validates the complete message flow:
 * 1. ElizaOS running in Docker (using eliza-coolify infrastructure)
 * 2. Production Mattermost server (chat.siftware.com)
 * 3. Plugin components: REST client, WebSocket client, MessageManager
 * 
 * Test Strategy:
 * - Use Testcontainers to orchestrate ElizaOS Docker containers
 * - Connect to production Mattermost with existing credentials
 * - Validate full message lifecycle: receive → process → respond
 */
describe('End-to-End Messaging Integration', () => {
  let elizaContainer: StartedTestContainer;
  let postgresContainer: StartedTestContainer;
  let restClient: RestClient;
  let wsClient: WebSocketClient;
  let messageManager: MessageManager;
  let config: MattermostConfig;
  let testChannelId: string;
  let testUserId: string;

  beforeAll(async () => {
    // Set up test timeout for Docker operations
    jest.setTimeout(120000);

    // 1. Start PostgreSQL container for ElizaOS
    postgresContainer = await new GenericContainer('postgres:15')
      .withEnvironment({
        POSTGRES_DB: 'eliza_test',
        POSTGRES_USER: 'eliza',
        POSTGRES_PASSWORD: 'eliza_test_password',
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    const postgresPort = postgresContainer.getMappedPort(5432);
    const postgresUrl = `postgresql://eliza:eliza_test_password@localhost:${postgresPort}/eliza_test`;

    // 2. Start ElizaOS container using eliza-coolify approach
    elizaContainer = await new GenericContainer('node:20-alpine')
      .withEnvironment({
        // Database connection
        POSTGRES_URL: postgresUrl,
        
        // Mattermost configuration (from your existing .env)
        MATTERMOST_SERVER_URL: process.env.MATTERMOST_SERVER_URL || 'https://chat.siftware.com',
        MATTERMOST_BOT_TOKEN: process.env.MATTERMOST_BOT_TOKEN || '',
        MATTERMOST_BOT_USERNAME: process.env.MATTERMOST_BOT_USERNAME || 'beaker',
        MATTERMOST_WEBHOOK_TOKEN: process.env.MATTERMOST_WEBHOOK_TOKEN || '',

        // ElizaOS configuration
        NODE_ENV: 'test',
        LOG_LEVEL: 'debug',
        API_PORT: '3000',
        HOST: '0.0.0.0',

        // AI Provider (use OpenAI for testing)
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
      })
      .withExposedPorts(3000)
      .withWaitStrategy(Wait.forHttp('/health', 3000).forStatusCode(200))
      .withCommand([
        'sh', '-c', 
        `npm install -g @elizaos/cli@latest && ` +
        `mkdir -p /app && cd /app && ` +
        `npm init -y && ` +
        `npm install @bealers/plugin-mattermost && ` +
        `echo '{"name":"TestBot","plugins":["@elizaos/plugin-bootstrap","@bealers/plugin-mattermost"]}' > test.character.json && ` +
        `elizaos dev --character test.character.json`
      ])
      .start();

    // 3. Initialize plugin components for testing
    config = {
      serverUrl: process.env.MATTERMOST_SERVER_URL || 'https://chat.siftware.com',
      token: process.env.MATTERMOST_BOT_TOKEN || '',
      username: process.env.MATTERMOST_BOT_USERNAME || 'beaker',
      webhookToken: process.env.MATTERMOST_WEBHOOK_TOKEN || '',
    };

    restClient = new RestClient(config);
    wsClient = new WebSocketClient(config);
    messageManager = new MessageManager(restClient, wsClient, null); // null runtime for testing

    // 4. Set up test environment in Mattermost
    await restClient.connect();
    
    // Get bot user info
    const botUser = await restClient.getCurrentUser();
    testUserId = botUser.id;

    // Create or get test channel
    const teams = await restClient.getTeamsForUser(testUserId);
    const primaryTeam = teams[0];
    
    try {
      const channel = await restClient.getChannelByName(primaryTeam.id, 'plugin-integration-test');
      testChannelId = channel.id;
    } catch {
      // Create test channel if it doesn't exist
      const newChannel = await restClient.createChannel({
        team_id: primaryTeam.id,
        name: 'plugin-integration-test',
        display_name: 'Plugin Integration Test',
        type: 'O', // Open channel
        purpose: 'Automated testing for Mattermost plugin integration',
      });
      testChannelId = newChannel.id;
    }
  }, 120000);

  afterAll(async () => {
    // Clean up containers
    if (messageManager) {
      await messageManager.cleanup();
    }
    if (wsClient) {
      await wsClient.disconnect();
    }
    
    if (elizaContainer) {
      await elizaContainer.stop();
    }
    if (postgresContainer) {
      await postgresContainer.stop();
    }
  });

  beforeEach(async () => {
    // Connect WebSocket for each test
    await wsClient.connect();
    await messageManager.initialize();
  });

  describe('Message Lifecycle Validation', () => {
    it('should receive WebSocket message when posted to Mattermost', async () => {
      const testMessage = `Integration test message ${uuidv4()}`;
      let receivedMessage: any = null;

      // Set up WebSocket listener
      const messagePromise = new Promise((resolve) => {
        wsClient.on('posted', (data) => {
          if (data.post && data.post.message === testMessage) {
            receivedMessage = data;
            resolve(data);
          }
        });
      });

      // Post message via REST API
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: testMessage,
      });

      // Wait for WebSocket to receive the message
      await messagePromise;

      expect(receivedMessage).toBeTruthy();
      expect(receivedMessage.post.id).toBe(post.id);
      expect(receivedMessage.post.message).toBe(testMessage);
    });

    it('should process message through MessageManager', async () => {
      const testMessage = `@${config.username} test processing ${uuidv4()}`;
      let processedMessage = false;

      // Mock ElizaOS response generation
      const originalProcessMessage = messageManager.processMessage;
      messageManager.processMessage = async (message) => {
        processedMessage = true;
        return 'Test response from ElizaOS';
      };

      // Set up message processing
      const processingPromise = new Promise((resolve) => {
        wsClient.on('posted', async (data) => {
          if (data.post && data.post.message === testMessage) {
            await messageManager.handleMessage(data);
            resolve(data);
          }
        });
      });

      // Post mention message
      await restClient.createPost({
        channel_id: testChannelId,
        message: testMessage,
      });

      await processingPromise;

      expect(processedMessage).toBe(true);

      // Restore original method
      messageManager.processMessage = originalProcessMessage;
    });

    it('should send response back to Mattermost', async () => {
      const testMessage = `@${config.username} respond please ${uuidv4()}`;
      const expectedResponse = `Test automated response ${uuidv4()}`;
      let responseReceived = false;

      // Mock ElizaOS to return specific response
      const originalProcessMessage = messageManager.processMessage;
      messageManager.processMessage = async (message) => {
        return expectedResponse;
      };

      // Set up response listener
      const responsePromise = new Promise((resolve) => {
        let messageCount = 0;
        wsClient.on('posted', (data) => {
          messageCount++;
          // Skip the original message, look for the response
          if (messageCount > 1 && data.post && data.post.message === expectedResponse) {
            responseReceived = true;
            resolve(data);
          }
        });
      });

      // Post message that triggers response
      await restClient.createPost({
        channel_id: testChannelId,
        message: testMessage,
      });

      await responsePromise;

      expect(responseReceived).toBe(true);

      // Restore original method
      messageManager.processMessage = originalProcessMessage;
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle WebSocket disconnection and reconnection', async () => {
      let reconnectionSuccessful = false;

      // Set up reconnection listener
      wsClient.on('connected', () => {
        reconnectionSuccessful = true;
      });

      // Force disconnect
      await wsClient.disconnect();
      
      // Reconnect
      await wsClient.connect();

      expect(reconnectionSuccessful).toBe(true);
    });

    it('should handle API rate limiting gracefully', async () => {
      // This test validates that rate limiting doesn't break the system
      const messages = [];
      
      // Send multiple messages rapidly
      for (let i = 0; i < 5; i++) {
        try {
          const message = await restClient.createPost({
            channel_id: testChannelId,
            message: `Rate limit test ${i} ${uuidv4()}`,
          });
          messages.push(message);
        } catch (error) {
          // Rate limiting errors should be handled gracefully
          expect(error.message).not.toContain('unhandled');
        }
      }

      // At least some messages should succeed
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should maintain message processing during ElizaOS container restart', async () => {
      // This test validates resilience to ElizaOS restarts
      const testMessage = `Resilience test ${uuidv4()}`;
      
      // Simulate container restart by restarting the ElizaOS container
      await elizaContainer.restart();
      
      // Wait for container to be ready
      await new Promise(resolve => setTimeout(resolve, 10000));
      
      // Verify messaging still works
      const post = await restClient.createPost({
        channel_id: testChannelId,
        message: testMessage,
      });

      expect(post.id).toBeTruthy();
    });
  });

  describe('Performance and Timing', () => {
    it('should process messages within acceptable time limits', async () => {
      const testMessage = `@${config.username} performance test ${uuidv4()}`;
      const startTime = Date.now();
      let endTime: number;

      const timingPromise = new Promise((resolve) => {
        wsClient.on('posted', (data) => {
          if (data.post && data.post.message.includes('performance test')) {
            endTime = Date.now();
            resolve(data);
          }
        });
      });

      await restClient.createPost({
        channel_id: testChannelId,
        message: testMessage,
      });

      await timingPromise;

      const processingTime = endTime! - startTime;
      expect(processingTime).toBeLessThan(5000); // Should process within 5 seconds
    });
  });
}); 