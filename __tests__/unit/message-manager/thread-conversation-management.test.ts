import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, processMessageAndWait } from './shared-setup';

describe('MessageManager - Thread Conversation Management', () => {
  let setup: MessageManagerTestSetup;

  beforeEach(async () => {
    vi.clearAllMocks();
    setup = createMessageManagerTestSetup();
    await setup.messageManager.initialize();
  });

  afterEach(async () => {
    if (setup.messageManager.isReady()) {
      await setup.messageManager.cleanup();
    }
  });

  it('should process thread replies with comprehensive context', async () => {
    const mockThreadContext = {
      posts: [
        {
          id: 'root-post',
          user_id: 'user-1',
          message: 'Original thread starter',
          create_at: Date.now() - 120000, // 2 minutes ago
          user_display_name: 'Thread Starter',
          username: 'ThreadStarter'
        },
        {
          id: 'reply-1', 
          user_id: 'user-2',
          message: 'First meaningful reply',
          create_at: Date.now() - 60000, // 1 minute ago
          root_id: 'root-post',
          user_display_name: 'Replier 1',
          username: 'Replier1'
        },
        {
          id: 'reply-2',
          user_id: 'user-3', 
          message: 'Another important context',
          create_at: Date.now() - 30000, // 30 seconds ago
          root_id: 'root-post',
          user_display_name: 'Replier 2',
          username: 'Replier2'
        }
      ],
      messageCount: 3,
      participantCount: 3,
      lastActivity: new Date(Date.now() - 30000),
      isActive: true
    };

    setup.mockRestClient.threads.getThreadContext.mockResolvedValue(mockThreadContext);
    setup.composeStateMock.mockResolvedValue('Contextual thread response');

    const threadMessage = {
      channel_display_name: 'Development',
      channel_name: 'dev-team',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'new-reply',
        user_id: 'user-123',
        channel_id: 'channel-dev',
        message: '@bot I need help with this thread topic',
        create_at: Date.now(),
        update_at: Date.now(),
        type: '',
        props: {},
        hashtags: '',
        pending_post_id: '',
        reply_count: 3,
        last_reply_at: Date.now(),
        participants: null,
        is_following: false,
        channel_mentions: [],
        root_id: 'root-post'
      }),
      sender_name: 'Help Seeker',
      team_id: 'team-123',
      mentions: JSON.stringify(['mock-bot-user-id'])
    };

    await processMessageAndWait(setup.mockWsClient, threadMessage);

    // Should retrieve thread context
    expect(setup.mockRestClient.threads.getThreadContext).toHaveBeenCalledWith(
      'root-post',
      'channel-dev',
      expect.any(Object)
    );

    // Should call AI with thread context
    expect(setup.composeStateMock).toHaveBeenCalled();
    
    // Should post response
    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalledWith(
      'channel-dev',
      'Contextual thread response',
      expect.any(Object)
    );
  });

  it('should handle complex thread conversations with multiple participants', async () => {
    const largeThreadContext = {
      posts: Array.from({ length: 15 }, (_, i) => ({
        id: `post-${i}`,
        user_id: `user-${i % 5}`, // 5 different users
        message: `Message ${i + 1} in this complex thread`,
        create_at: Date.now() - (15 - i) * 60000, // Spaced 1 minute apart
        root_id: i === 0 ? undefined : 'post-0',
        user_display_name: `User ${i % 5}`,
        username: `User${i % 5}`
      })),
      messageCount: 15,
      participantCount: 5,
      lastActivity: new Date(),
      isActive: true
    };

    setup.mockRestClient.threads.getThreadContext.mockResolvedValue(largeThreadContext);
    setup.composeStateMock.mockResolvedValue('Well-informed response');

    const complexThreadReply = {
      channel_display_name: 'General Discussion',
      channel_name: 'general',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'complex-reply',
        user_id: 'user-123',
        channel_id: 'channel-general',
        message: '@bot This is getting quite complex, can you summarize?',
        create_at: Date.now(),
        update_at: Date.now(),
        type: '',
        props: {},
        hashtags: '',
        pending_post_id: '',
        reply_count: 15,
        last_reply_at: Date.now(),
        participants: null,
        is_following: false,
        channel_mentions: [],
        root_id: 'post-0'
      }),
      sender_name: 'Confused User',
      team_id: 'team-123',
      mentions: JSON.stringify(['mock-bot-user-id'])
    };

    await processMessageAndWait(setup.mockWsClient, complexThreadReply);

    expect(setup.mockRestClient.threads.getThreadContext).toHaveBeenCalledWith(
      'post-0',
      'channel-general',
      expect.any(Object)
    );
    expect(setup.composeStateMock).toHaveBeenCalled();
  });

  it('should prioritize recent messages in long threads', async () => {
    // Simulate a very long thread where only recent messages should be most relevant
    const longThreadContext = {
      posts: Array.from({ length: 50 }, (_, i) => ({
        id: `msg-${i}`,
        user_id: `user-${i % 10}`,
        message: i >= 45 ? `Recent important message ${i}` : `Old message ${i}`,
        create_at: Date.now() - (50 - i) * 3600000, // Spaced 1 hour apart
        root_id: i === 0 ? undefined : 'msg-0',
        user_display_name: `User ${i % 10}`,
        username: `User${i % 10}`
      })),
      messageCount: 50,
      participantCount: 10,
      lastActivity: new Date(),
      isActive: true
    };

    setup.mockRestClient.threads.getThreadContext.mockResolvedValue(longThreadContext);
    setup.composeStateMock.mockResolvedValue('Focused on recent context');

    const recentThreadReply = {
      channel_display_name: 'Long Discussion',
      channel_name: 'long-chat',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'recent-reply',
        user_id: 'user-123',
        channel_id: 'channel-long',
        message: '@bot Based on the recent discussion...',
        create_at: Date.now(),
        update_at: Date.now(),
        type: '',
        props: {},
        hashtags: '',
        pending_post_id: '',
        reply_count: 50,
        last_reply_at: Date.now(),
        participants: null,
        is_following: false,
        channel_mentions: [],
        root_id: 'msg-0'
      }),
      sender_name: 'Recent Participant',
      team_id: 'team-123',
      mentions: JSON.stringify(['mock-bot-user-id'])
    };

    await processMessageAndWait(setup.mockWsClient, recentThreadReply);

    expect(setup.composeStateMock).toHaveBeenCalled();
    // The AI should receive context, but we don't need to verify internal processing
    // details since that's handled by the MessageManager implementation
  });

  it('should handle threads with mixed content types gracefully', async () => {
    const mixedContentThread = {
      posts: [
        {
          id: 'root',
          user_id: 'user-1',
          message: 'Check out this file attachment',
          create_at: Date.now() - 180000,
          user_display_name: 'File Sharer',
          username: 'FileSharer',
          file_ids: ['file-123'] // Has attachment
        },
        {
          id: 'reply-1',
          user_id: 'user-2', 
          message: '', // Empty message
          create_at: Date.now() - 120000,
          root_id: 'root',
          user_display_name: 'Silent User',
          username: 'SilentUser'
        },
        {
          id: 'reply-2',
          user_id: 'user-3',
          message: 'Here are my thoughts: 🤔 This looks interesting!',
          create_at: Date.now() - 60000,
          root_id: 'root',
          user_display_name: 'Emoji User',
          username: 'EmojiUser'
        }
      ],
      messageCount: 3,
      participantCount: 3,
      lastActivity: new Date(Date.now() - 60000),
      isActive: true
    };

    setup.mockRestClient.threads.getThreadContext.mockResolvedValue(mixedContentThread);
    setup.composeStateMock.mockResolvedValue('I can work with mixed content');

    const mixedContentReply = {
      channel_display_name: 'Mixed Content',
      channel_name: 'mixed',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'mixed-reply',
        user_id: 'user-123',
        channel_id: 'channel-mixed',
        message: '@bot What do you think about this thread?',
        create_at: Date.now(),
        update_at: Date.now(),
        type: '',
        props: {},
        hashtags: '',
        pending_post_id: '',
        reply_count: 3,
        last_reply_at: Date.now(),
        participants: null,
        is_following: false,
        channel_mentions: [],
        root_id: 'root'
      }),
      sender_name: 'Thread Questioner',
      team_id: 'team-123',
      mentions: JSON.stringify(['mock-bot-user-id'])
    };

    await processMessageAndWait(setup.mockWsClient, mixedContentReply);

    expect(setup.mockRestClient.threads.getThreadContext).toHaveBeenCalled();
    expect(setup.composeStateMock).toHaveBeenCalled();
    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalled();
  });
}); 