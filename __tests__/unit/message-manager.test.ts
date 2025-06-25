import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { IAgentRuntime, ModelType } from '@elizaos/core';
import { MessageManager } from '../../src/managers/message.manager';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { RestClient } from '../../src/clients/rest.client';
import { MattermostConfig } from '../../src/config';
import { createMockConfig, createMockRuntime, createMockWebSocketClient, createMockRestClient } from '../utils/test-utils';

// Mock ElizaOS imports
vi.mock('@elizaos/core', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
  
  return {
    elizaLogger: mockLogger,
    ModelType: {
      TEXT_LARGE: 'TEXT_LARGE'
    },
    createSafeLogger: vi.fn(() => mockLogger)
  };
});

describe('MessageManager', () => {
  let messageManager: MessageManager;
  let mockConfig: MattermostConfig;
  let mockRuntime: IAgentRuntime;
  let mockWsClient: WebSocketClient;
  let mockRestClient: RestClient;
  let useModelMock: MockedFunction<any>;
  let composeStateMock: any;

  // Helper function to process message and wait for async completion
  const processMessageAndWait = async (messageData: any) => {
    const postedHandler = vi.mocked(mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    expect(postedHandler).toBeDefined();
    
    await postedHandler!(messageData);
    // Wait for async processing via setImmediate
    await new Promise(resolve => setImmediate(resolve));
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock dependencies
    mockConfig = createMockConfig();
    mockRuntime = createMockRuntime();
    mockWsClient = createMockWebSocketClient() as any;
    mockRestClient = createMockRestClient() as any;

    // Setup useModel mock
    useModelMock = vi.fn().mockResolvedValue('Mock AI response');
    mockRuntime.useModel = useModelMock;

    // Setup mock runtime with composeState method
    composeStateMock = vi.fn().mockResolvedValue('Mocked AI response');
    mockRuntime.composeState = composeStateMock;

    // Create MessageManager instance
    messageManager = new MessageManager(
      mockConfig,
      mockRuntime,
      mockWsClient,
      mockRestClient
    );
  });

  afterEach(async () => {
    if (messageManager.isReady()) {
      await messageManager.cleanup();
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid dependencies', async () => {
      expect(messageManager.isReady()).toBe(false);
      
      await messageManager.initialize();
      
      expect(messageManager.isReady()).toBe(true);
      expect(messageManager.getBotUserId()).toBe('mock-bot-user-id');
      expect(mockRestClient.initialize).toHaveBeenCalled();
      expect(mockRestClient.getBotUser).toHaveBeenCalled();
    });

    it('should handle initialization failure gracefully', async () => {
      const mockError = new Error('REST client initialization failed');
      vi.mocked(mockRestClient.initialize).mockRejectedValue(mockError);

      await expect(messageManager.initialize()).rejects.toThrow(
        'MessageManager initialization failed: REST client initialization failed'
      );
      
      expect(messageManager.isReady()).toBe(false);
    });

    it('should not initialize twice', async () => {
      await messageManager.initialize();
      const firstCallCount = vi.mocked(mockRestClient.initialize).mock.calls.length;
      
      await messageManager.initialize();
      const secondCallCount = vi.mocked(mockRestClient.initialize).mock.calls.length;
      
      expect(secondCallCount).toBe(firstCallCount);
    });

    it('should register WebSocket event handlers during initialization', async () => {
      await messageManager.initialize();
      
      expect(mockWsClient.on).toHaveBeenCalledWith('posted', expect.any(Function));
      expect(mockWsClient.on).toHaveBeenCalledWith('post_edited', expect.any(Function));
      expect(mockWsClient.on).toHaveBeenCalledWith('channel_viewed', expect.any(Function));
    });
  });

  describe('Cleanup', () => {
    it('should cleanup properly', async () => {
      await messageManager.initialize();
      
      await messageManager.cleanup();
      
      expect(messageManager.isReady()).toBe(false);
      expect(messageManager.getBotUserId()).toBe(null);
      expect(mockWsClient.off).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      await messageManager.initialize();
      
      const mockError = new Error('Cleanup error');
      vi.mocked(mockWsClient.off).mockImplementation(() => {
        throw mockError;
      });

      // Should not throw, just log the error
      await expect(messageManager.cleanup()).resolves.not.toThrow();
    });
  });

  describe('Message Filtering', () => {
    beforeEach(async () => {
      await messageManager.initialize();
    });

    it('should process direct messages', async () => {
      const directMessage = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'msg-1',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: 'Hello bot!',
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
      };

      // Process message and wait for completion
      await processMessageAndWait(directMessage);
      
      // Should call AI generation
      expect(composeStateMock).toHaveBeenCalled();
    });

    it('should process mentions in public channels', async () => {
      const mentionMessage = {
        channel_display_name: 'General',
        channel_name: 'general',
        channel_type: 'O',
        post: JSON.stringify({
          id: 'msg-2',
          user_id: 'user-456',
          channel_id: 'channel-general',
          message: '@bot help me',
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
        team_id: 'team-123',
        mentions: JSON.stringify(['mock-bot-user-id'])
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(mentionMessage);
      
      // Wait for async processing
      await new Promise(resolve => setImmediate(resolve));
      
      expect(composeStateMock).toHaveBeenCalled();
    });

    it('should skip bot\'s own messages', async () => {
      const botMessage = {
        channel_display_name: 'General',
        channel_name: 'general',
        channel_type: 'O',
        post: JSON.stringify({
          id: 'msg-3',
          user_id: 'mock-bot-user-id', // Bot's own message
          channel_id: 'channel-general',
          message: 'I am responding',
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
        sender_name: 'Bot',
        team_id: 'team-123'
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(botMessage);
      
      // Should not call AI generation for bot's own message
      expect(composeStateMock).not.toHaveBeenCalled();
    });

    it('should skip public channel messages without mentions', async () => {
      const publicMessage = {
        channel_display_name: 'General',
        channel_name: 'general',
        channel_type: 'O',
        post: JSON.stringify({
          id: 'msg-4',
          user_id: 'user-789',
          channel_id: 'channel-general',
          message: 'Just a regular message',
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(publicMessage);
      
      // Should not call AI generation for non-mentioned public message
      expect(composeStateMock).not.toHaveBeenCalled();
    });

    it('should skip system messages', async () => {
      const systemMessage = {
        channel_display_name: 'General',
        channel_name: 'general',
        channel_type: 'O',
        post: JSON.stringify({
          id: 'msg-5',
          user_id: 'user-123',
          channel_id: 'channel-general',
          message: '',
          create_at: Date.now(),
          update_at: Date.now(),
          type: 'system_join_channel',
          props: {},
          hashtags: '',
          pending_post_id: '',
          reply_count: 0,
          last_reply_at: 0,
          participants: null,
          is_following: false,
          channel_mentions: []
        }),
        sender_name: 'System',
        team_id: 'team-123'
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(systemMessage);
      
      expect(composeStateMock).not.toHaveBeenCalled();
    });
  });

  describe('Thread Context Handling', () => {
    beforeEach(async () => {
      await messageManager.initialize();
    });

    it('should retrieve thread context for reply messages', async () => {
      // Mock thread context response
      const mockThreadPosts = {
        posts: {
          'original-post': {
            id: 'original-post',
            user_id: 'user-456',
            message: 'Original message',
            create_at: Date.now() - 60000,
            user_display_name: 'Original User'
          },
          'reply-1': {
            id: 'reply-1',
            user_id: 'user-789',
            message: 'First reply',
            create_at: Date.now() - 30000,
            user_display_name: 'Reply User'
          }
        }
      };

      vi.mocked(mockRestClient.getPostsAroundPost).mockResolvedValue(mockThreadPosts);

      const threadReply = {
        channel_display_name: 'General',
        channel_name: 'general',
        channel_type: 'O',
        post: JSON.stringify({
          id: 'msg-thread',
          user_id: 'user-123',
          channel_id: 'channel-general',
          message: 'This is a reply',
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
          root_id: 'original-post'
        }),
        sender_name: 'Test User',
        team_id: 'team-123',
        mentions: JSON.stringify(['mock-bot-user-id'])
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(threadReply);
      
      // Wait for async processing
      await new Promise(resolve => setImmediate(resolve));
      
      expect(mockRestClient.getPostsAroundPost).toHaveBeenCalledWith(
        'original-post',
        'channel-general',
        { before: 10, after: 10 }
      );

      expect(composeStateMock).toHaveBeenCalled();
    });

    it('should handle thread context retrieval failure gracefully', async () => {
      vi.mocked(mockRestClient.getPostsAroundPost).mockRejectedValue(new Error('API Error'));

      const threadReply = {
        channel_display_name: 'General',
        channel_name: 'general',
        channel_type: 'O',
        post: JSON.stringify({
          id: 'msg-thread',
          user_id: 'user-123',
          channel_id: 'channel-general',
          message: 'This is a reply',
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
          root_id: 'original-post'
        }),
        sender_name: 'Test User',
        team_id: 'team-123',
        mentions: JSON.stringify(['mock-bot-user-id'])
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      // Should not throw, should continue without context
      await expect(postedHandler!(threadReply)).resolves.not.toThrow();
      
      // Should still call AI generation, just without context
      expect(composeStateMock).toHaveBeenCalled();
    });
  });

  describe('AI Response Generation', () => {
    beforeEach(async () => {
      await messageManager.initialize();
    });

    it('should handle string responses from AI model', async () => {
      composeStateMock.mockResolvedValue('Simple string response');

      const directMessage = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'msg-1',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: 'Hello bot!',
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(directMessage);
      
      expect(mockRestClient.posts.createPost).toHaveBeenCalledWith(
        'channel-dm',
        'Simple string response',
        { rootId: 'msg-1' }
      );
    });

    it('should handle object responses from AI model', async () => {
      composeStateMock.mockResolvedValue({ message: 'Object response message' });

      const directMessage = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'msg-1',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: 'Hello bot!',
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(directMessage);
      
      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        'channel-dm',
        'Object response message',
        { rootId: 'msg-1' }
      );
    });

    it('should handle null/undefined responses from AI model', async () => {
      composeStateMock.mockResolvedValue(null);

      const directMessage = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'msg-1',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: 'Hello bot!',
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(directMessage);
      
      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        'channel-dm',
        expect.stringContaining('Hi user-123!'),
        { rootId: 'msg-1' }
      );
    });
  });

  describe('Error Handling and Circuit Breakers', () => {
    beforeEach(async () => {
      await messageManager.initialize();
    });

    it('should handle AI generation failures with user-friendly messages', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      composeStateMock.mockRejectedValue(rateLimitError);

      const directMessage = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'msg-1',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: 'Hello bot!',
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(directMessage);
      
      // Should post an error message to user
      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        'channel-dm',
        expect.stringContaining('getting a lot of requests'),
        { rootId: 'msg-1' }
      );
    });

    it('should handle message posting failures with retry logic', async () => {
      composeStateMock.mockResolvedValue('Good response');
      mockRestClient.createPost.mockRejectedValueOnce(new Error('Network error'))
                                .mockResolvedValueOnce({ id: 'retry-success' });

      const directMessage = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'msg-1',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: 'Hello bot!',
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(directMessage);
      
      // Should have retried the post
      expect(mockRestClient.createPost).toHaveBeenCalledTimes(2);
    });

    it('should handle malformed message data gracefully', async () => {
      const malformedMessage = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: 'invalid json',
        sender_name: 'Test User',
        team_id: 'team-123'
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      // Should not throw, should handle gracefully
      await expect(postedHandler!(malformedMessage)).resolves.not.toThrow();
      
      // Should not call AI generation for malformed data
      expect(composeStateMock).not.toHaveBeenCalled();
    });
  });

  describe('Cache Management', () => {
    beforeEach(async () => {
      await messageManager.initialize();
    });

    it('should prevent duplicate message processing', async () => {
      const message = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'duplicate-msg',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: 'Hello bot!',
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      // Process the same message twice
      await postedHandler!(message);
      await postedHandler!(message);
      
      // Should only call AI generation once
      expect(composeStateMock).toHaveBeenCalledTimes(1);
    });

    it('should provide cache statistics', async () => {
      const stats = messageManager.getCacheStats();
      
      expect(stats).toHaveProperty('processedCount');
      expect(stats).toHaveProperty('maxSize');
      expect(typeof stats.processedCount).toBe('number');
      expect(typeof stats.maxSize).toBe('number');
    });
  });

  describe('Health Monitoring', () => {
    beforeEach(async () => {
      await messageManager.initialize();
    });

    it('should provide health status including metrics and circuit breakers', async () => {
      const health = messageManager.getHealthStatus();
      
      expect(health).toHaveProperty('totalMessages');
      expect(health).toHaveProperty('successfulResponses');
      expect(health).toHaveProperty('failedResponses');
      expect(health).toHaveProperty('averageResponseTime');
      expect(health).toHaveProperty('errorsByType');
      expect(health).toHaveProperty('circuitBreakers');
      
      expect(typeof health.totalMessages).toBe('number');
      expect(typeof health.successfulResponses).toBe('number');
      expect(typeof health.failedResponses).toBe('number');
      expect(typeof health.averageResponseTime).toBe('number');
      expect(typeof health.errorsByType).toBe('object');
      expect(typeof health.circuitBreakers).toBe('object');
    });

    it('should track success and failure metrics', async () => {
      const initialHealth = messageManager.getHealthStatus();
      
      // Process a successful message
      composeStateMock.mockResolvedValue('Success response');
      
      const message = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'success-msg',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: 'Hello bot!',
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(message);
      
      const finalHealth = messageManager.getHealthStatus();
      
      expect(finalHealth.successfulResponses).toBeGreaterThan(initialHealth.successfulResponses);
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    beforeEach(async () => {
      await messageManager.initialize();
    });

    it('should handle empty or whitespace-only messages', async () => {
      const emptyMessage = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'empty-msg',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: '   \n\t   ',
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await postedHandler!(emptyMessage);
      
      // Should not call AI generation for empty messages
      expect(composeStateMock).not.toHaveBeenCalled();
    });

    it('should handle very long messages', async () => {
      const longMessage = 'x'.repeat(10000);
      
      const message = {
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: 'long-msg',
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: longMessage,
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
      };

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      await expect(postedHandler!(message)).resolves.not.toThrow();
      
      expect(composeStateMock).toHaveBeenCalled();
    });

    it('should handle concurrent message processing', async () => {
      composeStateMock.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve('Async response'), 100))
      );

      const messages = Array.from({ length: 5 }, (_, i) => ({
        channel_display_name: 'Direct Message',
        channel_name: 'user__bot',
        channel_type: 'D',
        post: JSON.stringify({
          id: `concurrent-msg-${i}`,
          user_id: 'user-123',
          channel_id: 'channel-dm',
          message: `Message ${i}`,
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
      }));

      const postedHandler = vi.mocked(mockWsClient.on).mock.calls
        .find(call => call[0] === 'posted')?.[1];
      
      // Process all messages concurrently
      const promises = messages.map(message => postedHandler!(message));
      
      await expect(Promise.all(promises)).resolves.not.toThrow();
      
      // Should have processed all 5 unique messages
      expect(composeStateMock).toHaveBeenCalledTimes(5);
    });
  });

  describe('Thread Conversation Management', () => {
    let messageManager: MessageManager;
    let mockRestClient: any;
    let mockWebSocketClient: any;
    let mockRuntime: any;
    let mockConfig: MattermostConfig;

    beforeEach(() => {
      // Setup mocks
      mockRestClient = {
        isReady: vi.fn().mockReturnValue(true),
        initialize: vi.fn().mockResolvedValue(undefined),
        getBotUser: vi.fn().mockResolvedValue({ id: 'bot123', username: 'test-bot' }),
        getThreadContext: vi.fn(),
        getUserProfiles: vi.fn(),
        createPost: vi.fn().mockResolvedValue({ id: 'post123' })
      };

      mockWebSocketClient = {
        on: vi.fn(),
        off: vi.fn(),
        removeAllListeners: vi.fn()
      };

      mockRuntime = {
        composeState: vi.fn()
      };

      mockConfig = {
        env: {
          MATTERMOST_URL: 'https://test.mattermost.com',
          MATTERMOST_TEAM: 'test-team',
          MATTERMOST_BOT_USERNAME: 'test-bot'
        }
      } as any;

      messageManager = new MessageManager(
        mockConfig,
        mockRuntime,
        mockWebSocketClient,
        mockRestClient
      );
    });

    test('should retrieve thread context successfully', async () => {
      // Mock thread data from REST client
      const mockThreadData = {
        threadId: 'thread123',
        rootPost: {
          id: 'root123',
          user_id: 'user1',
          message: 'Root message',
          create_at: 1640000000000
        },
        posts: [
          {
            id: 'root123',
            user_id: 'user1',
            message: 'Root message',
            create_at: 1640000000000
          },
          {
            id: 'reply1',
            user_id: 'user2',
            message: 'First reply',
            create_at: 1640000001000,
            root_id: 'root123'
          },
          {
            id: 'reply2',
            user_id: 'user1',
            message: 'Second reply',
            create_at: 1640000002000,
            root_id: 'root123'
          }
        ],
        totalMessages: 3
      };

      const mockUserProfiles = [
        { id: 'user1', username: 'alice' },
        { id: 'user2', username: 'bob' }
      ];

      mockRestClient.getThreadContext.mockResolvedValue(mockThreadData);
      mockRestClient.getUserProfiles.mockResolvedValue(mockUserProfiles);

      // Initialize the message manager
      await messageManager.initialize();

      // Access the private method using reflection for testing
      const getThreadContext = (messageManager as any).getThreadContext.bind(messageManager);
      const result = await getThreadContext('thread123', 'channel123');

      expect(result).toBeDefined();
      expect(result.threadId).toBe('thread123');
      expect(result.messageCount).toBe(3);
      expect(result.messages).toHaveLength(3);
      
      // Check message conversion
      expect(result.messages[0].username).toBe('alice');
      expect(result.messages[1].username).toBe('bob');
      expect(result.messages[2].username).toBe('alice');
      
      // Check chronological order
      expect(result.messages[0].timestamp).toBeLessThan(result.messages[1].timestamp);
      expect(result.messages[1].timestamp).toBeLessThan(result.messages[2].timestamp);
    });

    test('should handle thread context retrieval failure gracefully', async () => {
      mockRestClient.getThreadContext.mockRejectedValue(new Error('API Error'));

      await messageManager.initialize();

      const getThreadContext = (messageManager as any).getThreadContext.bind(messageManager);
      const result = await getThreadContext('thread123', 'channel123');

      expect(result).toBeNull();
      expect(mockRestClient.getThreadContext).toHaveBeenCalledWith('thread123', 'channel123', {
        maxMessages: 15,
        includeFuture: false
      });
    });

    test('should convert posts to thread messages with fallback usernames', async () => {
      const mockPosts = [
        {
          id: 'post1',
          user_id: 'user1',
          message: 'Test message',
          create_at: 1640000000000
        },
        {
          id: 'post2',
          user_id: 'user2',
          message: 'Another message',
          create_at: 1640000001000
        }
      ];

      // Mock user profile fetch failure
      mockRestClient.getUserProfiles.mockRejectedValue(new Error('User fetch failed'));

      await messageManager.initialize();

      const convertPostsToThreadMessages = (messageManager as any).convertPostsToThreadMessages.bind(messageManager);
      const result = await convertPostsToThreadMessages(mockPosts);

      expect(result).toHaveLength(2);
      expect(result[0].username).toBe('User-ser1'); // Fallback username from user ID
      expect(result[1].username).toBe('User-ser2');
      expect(result[0].message).toBe('Test message');
      expect(result[1].message).toBe('Another message');
    });

    test('should process thread reply with proper context', async () => {
      const mockPostedEvent = {
        channel_display_name: 'Test Channel',
        channel_name: 'test-channel',
        channel_type: 'O',
        post: JSON.stringify({
          id: 'reply123',
          user_id: 'user123',
          channel_id: 'channel123',
          message: 'This is a thread reply',
          create_at: 1640000000000,
          update_at: 1640000000000,
          type: '',
          props: {},
          hashtags: '',
          pending_post_id: '',
          reply_count: 0,
          last_reply_at: 0,
          participants: null,
          is_following: false,
          channel_mentions: [],
          root_id: 'root123' // This makes it a thread reply
        }),
        sender_name: 'Alice',
        team_id: 'team123'
      };

      const mockThreadContext = {
        threadId: 'root123',
        messages: [
          {
            id: 'root123',
            userId: 'user456',
            message: 'Original message',
            timestamp: 1639999999000,
            username: 'Bob'
          }
        ],
        messageCount: 1
      };

      mockRuntime.composeState.mockResolvedValue('AI response to thread');
      
      // Mock thread context retrieval
      const getThreadContext = vi.fn().mockResolvedValue(mockThreadContext);
      (messageManager as any).getThreadContext = getThreadContext;

      await messageManager.initialize();

      // Simulate the posted event
      const handlePostedEvent = (messageManager as any).handlePostedEvent.bind(messageManager);
      await handlePostedEvent(mockPostedEvent);

      // Verify thread context was retrieved
      expect(getThreadContext).toHaveBeenCalledWith('root123', 'channel123');

      // Verify AI response was called with thread context
      expect(mockRuntime.composeState).toHaveBeenCalled();
      
      // Verify response was posted as a thread reply
      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        'channel123',
        'AI response to thread',
        { rootId: 'root123' }
      );
    });

    test('should handle mention in channel by starting new thread', async () => {
      const mockPostedEvent = {
        channel_display_name: 'Test Channel',
        channel_name: 'test-channel',
        channel_type: 'O', // Open channel
        post: JSON.stringify({
          id: 'mention123',
          user_id: 'user123',
          channel_id: 'channel123',
          message: '@test-bot help me with this',
          create_at: 1640000000000,
          update_at: 1640000000000,
          type: '',
          props: {},
          hashtags: '',
          pending_post_id: '',
          reply_count: 0,
          last_reply_at: 0,
          participants: null,
          is_following: false,
          channel_mentions: []
          // No root_id - this is a top-level message
        }),
        sender_name: 'Alice',
        team_id: 'team123',
        mentions: JSON.stringify(['bot123']) // Bot is mentioned
      };

      mockRuntime.composeState.mockResolvedValue('Sure, I can help you with that!');

      await messageManager.initialize();

      // Simulate the posted event
      const handlePostedEvent = (messageManager as any).handlePostedEvent.bind(messageManager);
      await handlePostedEvent(mockPostedEvent);

      // Verify response was posted as a thread starter (rootId should be the mention message ID)
      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        'channel123',
        'Sure, I can help you with that!',
        { rootId: 'mention123' }
      );
    });

    test('should handle direct message without threading', async () => {
      const mockPostedEvent = {
        channel_display_name: 'Alice',
        channel_name: 'alice_bot123',
        channel_type: 'D', // Direct message
        post: JSON.stringify({
          id: 'dm123',
          user_id: 'user123',
          channel_id: 'dm_channel123',
          message: 'Hi there!',
          create_at: 1640000000000,
          update_at: 1640000000000,
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
        team_id: 'team123'
      };

      mockRuntime.composeState.mockResolvedValue('Hello Alice! How can I help you?');

      await messageManager.initialize();

      // Simulate the posted event
      const handlePostedEvent = (messageManager as any).handlePostedEvent.bind(messageManager);
      await handlePostedEvent(mockPostedEvent);

      // Verify response was posted without rootId (no threading in DMs)
      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        'dm_channel123',
        'Hello Alice! How can I help you?',
        { rootId: undefined }
      );
    });

    test('should build appropriate conversation context for thread reply', async () => {
      const mockThreadContext = {
        threadId: 'thread123',
        messages: [
          {
            id: 'root123',
            userId: 'user1',
            message: 'What is the weather like?',
            timestamp: 1640000000000,
            username: 'Alice'
          },
          {
            id: 'reply1',
            userId: 'bot123',
            message: 'I can help you check the weather! What location?',
            timestamp: 1640000001000,
            username: 'test-bot'
          },
          {
            id: 'reply2',
            userId: 'user1',
            message: 'New York please',
            timestamp: 1640000002000,
            username: 'Alice'
          }
        ],
        messageCount: 3
      };

      await messageManager.initialize();

      const buildConversationContext = (messageManager as any).buildConversationContext.bind(messageManager);
      const context = buildConversationContext(
        'Can you check current conditions?',
        mockThreadContext,
        {
          isDirectMessage: false,
          isMention: false,
          isThreadReply: true,
          channelName: 'general',
          senderName: 'Alice'
        }
      );

      expect(context).toContain('This is a reply in a thread discussion in the #general channel');
      expect(context).toContain('Previous conversation in this thread:');
      expect(context).toContain('Alice: What is the weather like?');
      expect(context).toContain('test-bot: I can help you check the weather! What location?');
      expect(context).toContain('Alice: New York please');
      expect(context).toContain('Current message from Alice: Can you check current conditions?');
      expect(context).toContain('continues the thread conversation naturally');
    });

    test('should generate appropriate fallback responses', async () => {
      await messageManager.initialize();

      const generateFallbackResponse = (messageManager as any).generateFallbackResponse.bind(messageManager);

      // Test DM fallback
      const dmFallback = generateFallbackResponse({
        isDirectMessage: true,
        isMention: false,
        isThreadReply: false,
        senderName: 'Alice'
      });
      expect(dmFallback).toContain('Hi Alice!');
      expect(dmFallback).toContain('rephrasing');

      // Test thread reply fallback
      const threadFallback = generateFallbackResponse({
        isDirectMessage: false,
        isMention: false,
        isThreadReply: true,
        senderName: 'Bob'
      });
      expect(threadFallback).toContain('thread discussion');

      // Test mention fallback
      const mentionFallback = generateFallbackResponse({
        isDirectMessage: false,
        isMention: true,
        isThreadReply: false,
        senderName: 'Charlie'
      });
      expect(mentionFallback).toContain('Thanks for mentioning me, Charlie!');
    });
  });
});

// Helper function to create mock WebSocket events
function createMockWebSocketEvent(options: {
  channelType?: string;
  postId?: string;
  userId?: string;
  message?: string;
  channelId?: string;
  channelName?: string;
  rootId?: string;
  mentions?: string;
  type?: string;
} = {}) {
  const {
    channelType = 'D',
    postId = 'test-post-id',
    userId = 'test-user-id',
    message = 'Test message',
    channelId = 'test-channel-id',
    channelName = 'test-channel',
    rootId,
    mentions,
    type = ''
  } = options;

  return {
    channel_display_name: channelName,
    channel_name: channelName,
    channel_type: channelType,
    post: JSON.stringify({
      id: postId,
      user_id: userId,
      channel_id: channelId,
      message: message,
      create_at: Date.now(),
      update_at: Date.now(),
      type: type,
      props: {},
      hashtags: '',
      pending_post_id: '',
      reply_count: 0,
      last_reply_at: 0,
      participants: null,
      is_following: false,
      channel_mentions: [],
      ...(rootId && { root_id: rootId })
    }),
    sender_name: 'Test User',
    team_id: 'test-team-id',
    ...(mentions && { mentions })
  };
} 