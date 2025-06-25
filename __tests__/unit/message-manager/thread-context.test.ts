import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, testData, processMessageAndWait } from './shared-setup';

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
    // Set up mocks first
    setup.composeStateMock.mockResolvedValue('Thread-aware response');
    
    // Mock thread context response with CORRECT structure (posts as array)
    const mockThreadContext = {
      posts: [
        {
          id: 'original-post',
          user_id: 'user-456',
          message: 'Original message',
          create_at: Date.now() - 60000,
          user_display_name: 'Original User',
          username: 'OriginalUser'
        }
      ],
      messageCount: 1,
      participantCount: 1,
      lastActivity: new Date(Date.now() - 60000),
      isActive: true
    };

    setup.mockRestClient.threads.getThreadContext.mockResolvedValue(mockThreadContext);

    // Create thread message exactly like the working filtering test, just add root_id
    const threadMessage = {
      channel_display_name: 'General',
      channel_name: 'general',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'thread-reply',
        user_id: 'user-456',
        channel_id: 'channel-general',
        message: '@bot help me in this thread',
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
        channel_mentions: [],
        root_id: 'original-post'
      }),
      sender_name: 'Test User',
      team_id: 'team-123',
      mentions: JSON.stringify(['mock-bot-user-id'])
    };

    // Use the exact same pattern as the working filtering test
    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(threadMessage);
    
    // Wait for async processing
    await new Promise(resolve => setImmediate(resolve));

    // Should call getThreadContext
    expect(setup.mockRestClient.threads.getThreadContext).toHaveBeenCalledWith(
      'original-post',
      'channel-general',
      expect.any(Object)
    );

    // Should generate AI response
    expect(setup.composeStateMock).toHaveBeenCalled();
  });

  it('should handle thread context retrieval failure gracefully', async () => {
    setup.mockRestClient.threads.getThreadContext.mockRejectedValue(new Error('API Error'));

    // Create a proper thread reply with bot mention
    const threadReply = {
      channel_display_name: 'General',
      channel_name: 'general', 
      channel_type: 'O',
      post: JSON.stringify({
        id: 'msg-thread-error',
        user_id: 'user-123',
        channel_id: 'channel-general',
        message: '@bot This is a reply that will fail context retrieval',
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

    setup.composeStateMock.mockResolvedValue('Response without context');

    // Should not throw, should continue without context
    await expect(processMessageAndWait(setup.mockWsClient, threadReply)).resolves.not.toThrow();
    
    // Should still call AI generation, just without context
    expect(setup.composeStateMock).toHaveBeenCalled();
  });
}); 