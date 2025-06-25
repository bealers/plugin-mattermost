import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MessageManager } from '../../../src/managers/message.manager';
import { MattermostConfig } from '../../../src/config';

describe('MessageManager - Thread Conversation Management', () => {
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

  it('should retrieve thread context successfully', async () => {
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

  it('should handle thread context retrieval failure gracefully', async () => {
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

  it('should convert posts to thread messages with fallback usernames', async () => {
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

  it('should process thread reply with proper context', async () => {
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

    // Simulate thread reply processing
    const postedHandler = vi.mocked(mockWebSocketClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(mockPostedEvent);

    // Verify thread context was retrieved
    expect(getThreadContext).toHaveBeenCalledWith('root123', 'channel123');
    
    // Verify AI was called with thread context
    expect(mockRuntime.composeState).toHaveBeenCalled();
  });
}); 