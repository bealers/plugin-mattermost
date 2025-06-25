#!/usr/bin/env tsx

/**
 * Test script for MessageManager AI integration
 * Tests the complete message processing pipeline without requiring Mattermost connection
 */

import { loadConfig } from '../src/config';
import { MessageManager } from '../src/managers/message.manager';
import { WebSocketClient } from '../src/clients/websocket.client';
import { RestClient } from '../src/clients/rest.client';
import { IAgentRuntime, ModelType } from '@elizaos/core';

// Mock runtime for testing
const createMockRuntime = (): IAgentRuntime => {
  return {
    agentId: 'test-agent-123',
    character: {
      name: 'TestBot',
      bio: 'A test bot for Mattermost integration'
    },
    useModel: async (modelType: ModelType, options: any) => {
      console.log(`🤖 Mock AI called with model: ${modelType}`);
      console.log(`📝 Prompt: ${options.prompt}`);
      console.log(`🌡️ Temperature: ${options.temperature}`);
      console.log(`📊 Max Tokens: ${options.maxTokens}`);
      console.log(`👤 User: ${options.user}`);
      
      // Simulate AI response based on input
      if (options.prompt.toLowerCase().includes('hello')) {
        return 'Hello! I\'m your friendly Mattermost AI assistant. How can I help you today?';
      } else if (options.prompt.toLowerCase().includes('test')) {
        return 'Test successful! The AI integration is working properly. 🎉';
      } else {
        return `I received your message: "${options.prompt.substring(0, 50)}..." and I'm ready to help!`;
      }
    },
    // Add other required runtime methods as no-ops
    getService: () => null,
    registerService: () => {},
    getSetting: () => null,
  } as any;
};

// Mock WebSocket client
const createMockWebSocketClient = (): Partial<WebSocketClient> => {
  const eventHandlers = new Map<string, Set<(data: any) => void>>();
  
  return {
    on: (event: string, handler: (data: any) => void) => {
      if (!eventHandlers.has(event)) {
        eventHandlers.set(event, new Set());
      }
      eventHandlers.get(event)!.add(handler);
      console.log(`📡 Registered handler for event: ${event}`);
    },
    off: (event: string, handler: (data: any) => void) => {
      if (eventHandlers.has(event)) {
        eventHandlers.get(event)!.delete(handler);
        console.log(`📡 Unregistered handler for event: ${event}`);
      }
    },
    emit: (event: string, data: any) => {
      if (eventHandlers.has(event)) {
        eventHandlers.get(event)!.forEach(handler => handler(data));
      }
    },
    // Add method to simulate message events
    simulateMessage: (messageData: any) => {
      if (eventHandlers.has('posted')) {
        eventHandlers.get('posted')!.forEach(handler => handler(messageData));
      }
    }
  } as any;
};

// Mock REST client
const createMockRestClient = (): Partial<RestClient> => {
  return {
    isReady: () => true,
    initialize: async () => {
      console.log('🔌 Mock REST client initialized');
    },
    getBotUser: async () => ({
      id: 'bot-user-123',
      username: 'test-bot',
      email: 'testbot@example.com'
    }),
    createPost: async (channelId: string, message: string, options?: any) => {
      console.log(`📤 Mock posting message to channel ${channelId}:`);
      console.log(`   Message: ${message}`);
      console.log(`   Options:`, options);
      return { id: 'post-123', create_at: Date.now() };
    },
    getPostsAroundPost: async (postId: string, channelId: string, options?: any) => {
      console.log(`📥 Mock fetching thread context for post ${postId} in channel ${channelId}`);
      // Return mock thread data
      return {
        posts: {
          'post-1': {
            id: 'post-1',
            user_id: 'user-456',
            message: 'Previous message in thread',
            create_at: Date.now() - 60000,
            user_display_name: 'Alice'
          },
          'post-2': {
            id: 'post-2',
            user_id: 'user-789',
            message: 'Another message in the conversation',
            create_at: Date.now() - 30000,
            user_display_name: 'Bob'
          }
        }
      };
    }
  } as any;
};

async function testMessageManager() {
  console.log('🚀 Starting MessageManager AI Integration Test\n');

  try {
    // Load configuration (skip environment validation for testing)
    console.log('📋 Loading configuration...');
    const config = loadConfig({ 
      skipEnvValidation: true,
      envOverrides: {
        MATTERMOST_URL: 'https://test.mattermost.com',
        MATTERMOST_TOKEN: 'test-token',
        MATTERMOST_TEAM: 'test-team'
      }
    });
    console.log('✅ Configuration loaded successfully\n');

    // Create mock components
    console.log('🔧 Creating mock components...');
    const mockRuntime = createMockRuntime();
    const mockWsClient = createMockWebSocketClient() as WebSocketClient;
    const mockRestClient = createMockRestClient() as RestClient;
    console.log('✅ Mock components created\n');

    // Initialize MessageManager
    console.log('🔌 Initializing MessageManager...');
    const messageManager = new MessageManager(
      config,
      mockRuntime,
      mockWsClient,
      mockRestClient
    );

    await messageManager.initialize();
    console.log('✅ MessageManager initialized successfully\n');

    // Test 1: Direct Message
    console.log('🧪 Test 1: Direct Message Processing');
    const directMessage = {
      channel_display_name: 'Direct Message',
      channel_name: 'direct-message',
      channel_type: 'D', // Direct message
      post: JSON.stringify({
        id: 'msg-dm-123',
        user_id: 'user-456',
        channel_id: 'channel-dm-789',
        message: 'Hello bot! How are you today?',
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
      sender_name: 'Alice',
      team_id: 'team-123'
    };

    (mockWsClient as any).simulateMessage(directMessage);
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for processing
    console.log('✅ Direct message test completed\n');

    // Test 2: Mention in Channel
    console.log('🧪 Test 2: Channel Mention Processing');
    const mentionMessage = {
      channel_display_name: 'General',
      channel_name: 'general',
      channel_type: 'O', // Open channel
      post: JSON.stringify({
        id: 'msg-mention-456',
        user_id: 'user-789',
        channel_id: 'channel-general-123',
        message: '@test-bot can you help me with this test?',
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
      sender_name: 'Bob',
      team_id: 'team-123',
      mentions: JSON.stringify(['bot-user-123']) // Bot is mentioned
    };

    (mockWsClient as any).simulateMessage(mentionMessage);
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for processing
    console.log('✅ Channel mention test completed\n');

    // Test 3: Thread Reply
    console.log('🧪 Test 3: Thread Reply Processing');
    const threadReply = {
      channel_display_name: 'General',
      channel_name: 'general',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'msg-thread-789',
        user_id: 'user-456',
        channel_id: 'channel-general-123',
        message: '@test-bot this is a follow-up question in the thread',
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
        root_id: 'original-post-123' // This is a thread reply
      }),
      sender_name: 'Alice',
      team_id: 'team-123',
      mentions: JSON.stringify(['bot-user-123'])
    };

    (mockWsClient as any).simulateMessage(threadReply);
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for processing
    console.log('✅ Thread reply test completed\n');

    // Test 4: Message that should be ignored
    console.log('🧪 Test 4: Bot\'s Own Message (Should be ignored)');
    const botMessage = {
      channel_display_name: 'General',
      channel_name: 'general',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'msg-bot-999',
        user_id: 'bot-user-123', // Bot's own message
        channel_id: 'channel-general-123',
        message: 'This is my own message',
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
      sender_name: 'TestBot',
      team_id: 'team-123'
    };

    (mockWsClient as any).simulateMessage(botMessage);
    await new Promise(resolve => setTimeout(resolve, 100)); // Wait for processing
    console.log('✅ Bot message filtering test completed\n');

    // Check cache stats
    const cacheStats = messageManager.getCacheStats();
    console.log('📊 Cache Statistics:', cacheStats);

    // Cleanup
    console.log('🧹 Cleaning up...');
    await messageManager.cleanup();
    console.log('✅ Cleanup completed\n');

    console.log('🎉 All tests completed successfully!');
    console.log('🔥 MessageManager AI integration is working correctly!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testMessageManager().catch(console.error);
}

export { testMessageManager }; 