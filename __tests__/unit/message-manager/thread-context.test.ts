import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, testData } from './shared-setup';

describe('MessageManager - Thread Context Handling', () => {
  let setup: MessageManagerTestSetup;

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    setup = createMessageManagerTestSetup();
    await setup.messageManager.initialize();
  });

  afterEach(async () => {
    if (setup.messageManager.isReady()) {
      await setup.messageManager.cleanup();
    }
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

    vi.mocked(setup.mockRestClient.getPostsAroundPost).mockResolvedValue(mockThreadPosts);

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

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(threadReply);
    
    // Wait for async processing
    await new Promise(resolve => setImmediate(resolve));
    
    expect(setup.mockRestClient.getPostsAroundPost).toHaveBeenCalledWith(
      'original-post',
      'channel-general',
      { before: 10, after: 10 }
    );

    expect(setup.composeStateMock).toHaveBeenCalled();
  });

  it('should handle thread context retrieval failure gracefully', async () => {
    vi.mocked(setup.mockRestClient.getPostsAroundPost).mockRejectedValue(new Error('API Error'));

    const threadReply = testData.threadReply('original-post');
    threadReply.mentions = JSON.stringify(['mock-bot-user-id']);

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    // Should not throw, should continue without context
    await expect(postedHandler!(threadReply)).resolves.not.toThrow();
    
    // Should still call AI generation, just without context
    expect(setup.composeStateMock).toHaveBeenCalled();
  });
}); 