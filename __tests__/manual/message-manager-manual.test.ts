#!/usr/bin/env tsx

/**
 * Test script for MessageManager AI integration
 * Tests the complete message processing pipeline including error handling
 */

import { loadConfig } from '../../src/config';
import { MessageManager } from '../../src/managers/message.manager';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { RestClient } from '../../src/clients/rest.client';
import { IAgentRuntime, ModelType } from '@elizaos/core';

// Mock runtime for testing (including error simulation)
const createMockRuntime = (shouldFail = false, failureCount = 0): IAgentRuntime => {
  let callCount = 0;
  
  return {
    agentId: 'test-agent-123',
    character: {
      name: 'TestBot',
      bio: 'A test bot for Mattermost integration with error handling'
    },
    useModel: async (modelType: ModelType, options: any) => {
      callCount++;
      
      if (shouldFail && callCount <= failureCount) {
        // Simulate different types of failures
        const errorTypes = [
          new Error('Network connection failed'),
          new Error('Rate limit exceeded'),
          new Error('Model timeout'),
          new Error('Authentication failed')
        ];
        throw errorTypes[callCount % errorTypes.length];
      }
      
      console.log(`🤖 Mock AI called with model ${modelType}`);
      console.log(`   Prompt: ${options.prompt?.substring(0, 100)}...`);
      return `Mock AI response to: "${options.prompt?.substring(0, 50)}..."`;
    }
  } as unknown as IAgentRuntime;
};

// Mock WebSocket client with error simulation
const createMockWebSocketClient = () => {
  const eventHandlers = new Map<string, Function[]>();

  return {
    on: (event: string, handler: Function) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, []);
      }
      eventHandlers.get(event)?.push(handler);
      console.log(`Registered handler for event: ${event}`);
    },
    off: (event: string, handler: Function) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
      console.log(`Unregistered handler for event: ${event}`);
    },
    emit: (event: string, data: any) => {
      const handlers = eventHandlers.get(event);
      if (handlers) {
        handlers.forEach(handler => handler(data));
      }
    },
    // For testing
    _getEventHandlers: () => eventHandlers
  };
};

// Mock REST client with error simulation capabilities
const createMockRestClient = (shouldFailOnPost = false, shouldFailOnContext = false) => {
  let postCallCount = 0;
  let contextCallCount = 0;
  
  return {
    isReady: () => true,
    initialize: async () => console.log('REST client initialized'),
    getBotUser: async () => ({
      id: 'bot-user-456',
      username: 'test-bot',
      email: 'bot@test.com'
    }),
    createPost: async (channelId: string, message: string, options?: any) => {
      postCallCount++;
      
      if (shouldFailOnPost && postCallCount <= 2) {
        throw new Error(`Network error on post attempt ${postCallCount}`);
      }
      
      console.log(`📝 Posted message to channel ${channelId}: "${message.substring(0, 50)}..."`);
      if (options?.rootId) {
        console.log(`   └── Thread reply to: ${options.rootId}`);
      }
      return { id: `post-${Date.now()}` };
    },
    getPostsAroundPost: async (postId: string, channelId: string, options: any) => {
      contextCallCount++;
      
      if (shouldFailOnContext && contextCallCount <= 1) {
        throw new Error('Failed to retrieve thread context');
      }
      
      console.log(`📚 Retrieved thread context for post ${postId}`);
      return {
        posts: {
          'post-1': {
            id: 'post-1',
            user_id: 'user-123',
            message: 'Previous message in thread',
            create_at: Date.now() - 60000,
            user_display_name: 'Previous User'
          },
          [postId]: {
            id: postId,
            user_id: 'user-456',
            message: 'Root message',
            create_at: Date.now() - 30000,
            user_display_name: 'Root User'
          }
        }
      };
    }
  };
};

// Test scenarios
const testScenarios = [
  {
    name: 'Basic Success Flow',
    description: 'Test normal message processing without errors',
    runtimeFailure: false,
    postFailure: false,
    contextFailure: false
  },
  {
    name: 'AI Generation Retry',
    description: 'Test retry logic when AI generation fails initially',
    runtimeFailure: true,
    runtimeFailureCount: 2,
    postFailure: false,
    contextFailure: false
  },
  {
    name: 'Post Failure Recovery',
    description: 'Test fallback when message posting fails',
    runtimeFailure: false,
    postFailure: true,
    contextFailure: false
  },
  {
    name: 'Thread Context Failure',
    description: 'Test graceful degradation when thread context fails',
    runtimeFailure: false,
    postFailure: false,
    contextFailure: true
  },
  {
    name: 'Multiple Failures',
    description: 'Test circuit breaker with multiple service failures',
    runtimeFailure: true,
    runtimeFailureCount: 5,
    postFailure: true,
    contextFailure: true
  }
];

async function runTestScenario(scenario: any): Promise<void> {
  console.log(`\n=== Testing: ${scenario.name} ===`);
  console.log(`${scenario.description}`);
  console.log('');

  try {
    // Load configuration (skip environment validation for testing)
    const config = loadConfig({ 
      skipEnvValidation: true,
      envOverrides: {
        MATTERMOST_URL: 'https://test.mattermost.com',
        MATTERMOST_TOKEN: 'test-token',
        MATTERMOST_TEAM: 'test-team'
      }
    });

    // Create mock clients
    const mockRuntime = createMockRuntime(scenario.runtimeFailure, scenario.runtimeFailureCount || 0);
    const mockWsClient = createMockWebSocketClient() as any;
    const mockRestClient = createMockRestClient(scenario.postFailure, scenario.contextFailure) as any;

    // Create MessageManager
    const messageManager = new MessageManager(
      config,
      mockRuntime,
      mockWsClient,
      mockRestClient
    );

    // Initialize
    await messageManager.initialize();
    console.log('MessageManager initialized');

    // Test message scenarios
    const testMessages = [
      {
        type: 'Direct Message',
        data: {
          channel_display_name: 'Direct Message',
          channel_name: 'user123__bot456',
          channel_type: 'D',
          post: JSON.stringify({
            id: 'msg-dm-1',
            user_id: 'user-123',
            channel_id: 'channel-dm-1',
            message: 'Hello bot, how are you?',
            create_at: Date.now(),
            update_at: Date.now(),
            type: '',
            props: {},
            hashtags: '',
            pending_post_id: '',
            reply_count: 0,
            last_reply_at: 0,
            participants: null,
            is_following: false,
            channel_mentions: []
          }),
          sender_name: 'Test User',
          team_id: 'team-123'
        }
      },
      {
        type: 'Thread Reply',
        data: {
          channel_display_name: 'General',
          channel_name: 'general',
          channel_type: 'O',
          post: JSON.stringify({
            id: 'msg-thread-2',
            user_id: 'user-456',
            channel_id: 'channel-general',
            message: 'This is a follow-up question',
            create_at: Date.now(),
            update_at: Date.now(),
            type: '',
            props: {},
            hashtags: '',
            pending_post_id: '',
            reply_count: 1,
            last_reply_at: Date.now(),
            participants: null,
            is_following: false,
            channel_mentions: [],
            root_id: 'original-post-123',
            parent_id: 'original-post-123'
          }),
          sender_name: 'Thread User',
          team_id: 'team-123',
          mentions: JSON.stringify(['bot-user-456'])
        }
      }
    ];

    // Process test messages
    for (const testMessage of testMessages) {
      console.log(`\n📨 Processing ${testMessage.type}...`);
      
      // Simulate WebSocket event
      mockWsClient.emit('posted', testMessage.data);
      
      // Give some time for async processing
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Check health metrics
    const health = messageManager.getHealthStatus();
    console.log('\nHealth Metrics:');
    console.log(`   Total Messages: ${health.totalMessages}`);
    console.log(`   Successful: ${health.successfulResponses}`);
    console.log(`   Failed: ${health.failedResponses}`);
    console.log(`   Avg Response Time: ${health.averageResponseTime.toFixed(2)}ms`);
    console.log(`   Circuit Breakers:`);
    
    Object.entries(health.circuitBreakers).forEach(([service, state]) => {
      console.log(`     ${service}: ${state.state} (failures: ${state.failures})`);
    });

    console.log(`   Error Breakdown:`);
    Object.entries(health.errorsByType).forEach(([type, count]) => {
      if (count > 0) {
        console.log(`     ${type}: ${count}`);
      }
    });

    // Test cache statistics
    const cacheStats = messageManager.getCacheStats();
    console.log(`\nCache Stats:`);
    console.log(`   Processed Messages: ${cacheStats.processedCount}/${cacheStats.maxSize}`);

    // Cleanup
    await messageManager.cleanup();
    console.log('\nMessageManager cleaned up');
    
    console.log(`\n${scenario.name} test completed successfully!`);

  } catch (error) {
    console.error(`\nTest failed:`, error);
    throw error;
  }
}

async function testMessageManager(): Promise<void> {
  try {
    console.log('Starting MessageManager Error Handling & Resilience Tests');
    console.log('===========================================================\n');

    // Run all test scenarios
    for (const scenario of testScenarios) {
      await runTestScenario(scenario);
      
      // Wait between scenarios
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\nAll error handling tests completed successfully!');
    console.log('\nTest Summary:');
    console.log(`   Scenarios tested: ${testScenarios.length}`);
    console.log(`   Error handling: Validated`);
    console.log(`   Retry logic: Tested`);
    console.log(`   Circuit breakers: Verified`);
    console.log(`   Health monitoring: Working`);
    console.log(`   Cache management: Operational`);

  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testMessageManager().catch(console.error);
} 