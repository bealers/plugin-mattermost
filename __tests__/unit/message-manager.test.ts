import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { IAgentRuntime, ModelType } from '@elizaos/core';
import { MessageManager } from '../../src/managers/message.manager';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { RestClient } from '../../src/clients/rest.client';
import { MattermostConfig } from '../../src/config';
import { createMockConfig, createMockRuntime, createMockWebSocketClient, createMockRestClient } from '../utils/test-utils';

describe('MessageManager', () => {
  let messageManager: MessageManager;
  let mockConfig: MattermostConfig;
  let mockRuntime: IAgentRuntime;
  let mockWsClient: WebSocketClient;
  let mockRestClient: RestClient;
  let useModelMock: MockedFunction<any>;

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
      expect(useModelMock).toHaveBeenCalledWith(ModelType.TEXT_LARGE, expect.objectContaining({
        prompt: 'Hello bot!',
        temperature: 0.7,
        maxTokens: 256,
        user: 'user-123'
      }));
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
      
      expect(useModelMock).toHaveBeenCalledWith(ModelType.TEXT_LARGE, expect.objectContaining({
        prompt: '@bot help me',
        user: 'user-456'
      }));
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
      expect(useModelMock).not.toHaveBeenCalled();
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
      expect(useModelMock).not.toHaveBeenCalled();
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
      
      expect(useModelMock).not.toHaveBeenCalled();
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

      expect(useModelMock).toHaveBeenCalledWith(ModelType.TEXT_LARGE, expect.objectContaining({
        prompt: expect.stringContaining('Previous conversation:')
      }));
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
      expect(useModelMock).toHaveBeenCalledWith(ModelType.TEXT_LARGE, expect.objectContaining({
        prompt: 'This is a reply'
      }));
    });
  });

  describe('AI Response Generation', () => {
    beforeEach(async () => {
      await messageManager.initialize();
    });

    it('should handle string responses from AI model', async () => {
      useModelMock.mockResolvedValue('Simple string response');

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
        'Simple string response',
        { rootId: 'msg-1' }
      );
    });

    it('should handle object responses from AI model', async () => {
      useModelMock.mockResolvedValue({ message: 'Object response message' });

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
      useModelMock.mockResolvedValue(null);

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
        expect.stringContaining('having trouble generating a response'),
        { rootId: 'msg-1' }
      );
    });
  });

  describe('Error Handling and Circuit Breakers', () => {
    beforeEach(async () => {
      await messageManager.initialize();
    });

    it('should handle AI generation failures with user-friendly messages', async () => {
      useModelMock.mockRejectedValue(new Error('Rate limit exceeded'));

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
      useModelMock.mockResolvedValue('Test response');
      
      // First call fails, second succeeds
      vi.mocked(mockRestClient.createPost)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ id: 'post-123' });

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
      expect(useModelMock).not.toHaveBeenCalled();
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
      expect(useModelMock).toHaveBeenCalledTimes(1);
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
      useModelMock.mockResolvedValue('Success response');
      
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
      expect(useModelMock).not.toHaveBeenCalled();
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
      
      expect(useModelMock).toHaveBeenCalledWith(ModelType.TEXT_LARGE, expect.objectContaining({
        prompt: longMessage,
        maxTokens: 256
      }));
    });

    it('should handle concurrent message processing', async () => {
      useModelMock.mockImplementation(() => 
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
      expect(useModelMock).toHaveBeenCalledTimes(5);
    });
  });
}); 