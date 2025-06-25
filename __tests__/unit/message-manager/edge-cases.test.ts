import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, processMessageAndWait } from './shared-setup';

describe('MessageManager - Edge Cases and Error Scenarios', () => {
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
      team_id: 'team-123',
      mentions: JSON.stringify(['mock-bot-user-id'])
    };

    // Should not trigger AI generation for empty messages
    await processMessageAndWait(setup.mockWsClient, emptyMessage);
    
    expect(setup.composeStateMock).not.toHaveBeenCalled();
  });

  it('should handle very long messages', async () => {
    const longMessage = 'A'.repeat(5000);
    
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
      team_id: 'team-123',
      mentions: JSON.stringify(['mock-bot-user-id'])
    };

    setup.composeStateMock.mockResolvedValue('I see you have a lot to say!');

    await expect(processMessageAndWait(setup.mockWsClient, message)).resolves.not.toThrow();
    
    expect(setup.composeStateMock).toHaveBeenCalled();
  });

  it('should handle concurrent message processing', async () => {
    setup.composeStateMock.mockResolvedValue('Concurrent response');

    const messages = Array.from({ length: 5 }, (_, i) => ({
      channel_display_name: 'Direct Message',
      channel_name: 'user__bot',
      channel_type: 'D',
      post: JSON.stringify({
        id: `concurrent-msg-${i}`,
        user_id: 'user-123',
        channel_id: 'channel-dm',
        message: `Message ${i + 1}`,
        create_at: Date.now() + i,
        update_at: Date.now() + i,
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
    }));

    // Process all messages concurrently
    await Promise.all(messages.map(msg => processMessageAndWait(setup.mockWsClient, msg)));
    
    // All messages should have been processed
    expect(setup.composeStateMock).toHaveBeenCalledTimes(5);
  });

  it('should handle messages with special characters and emojis', async () => {
    const specialMessage = {
      channel_display_name: 'Direct Message',
      channel_name: 'user__bot',
      channel_type: 'D',
      post: JSON.stringify({
        id: 'special-msg',
        user_id: 'user-123',
        channel_id: 'channel-dm',
        message: 'Hello 👋 @bot! Can you help with UTF-8: café, naïve, 中文? 🤖',
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

    setup.composeStateMock.mockResolvedValue('I can help with special characters!');

    await processMessageAndWait(setup.mockWsClient, specialMessage);
    
    expect(setup.composeStateMock).toHaveBeenCalled();
  });
}); 