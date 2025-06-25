import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup } from './shared-setup';

describe('MessageManager - Edge Cases and Error Scenarios', () => {
  let setup: MessageManagerTestSetup;

  beforeEach(async () => {
    setup = await createMessageManagerTestSetup();
    await setup.messageManager.initialize();
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

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(emptyMessage);
    
    // Should not call AI generation for empty messages
    expect(setup.composeStateMock).not.toHaveBeenCalled();
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

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await expect(postedHandler!(message)).resolves.not.toThrow();
    
    expect(setup.composeStateMock).toHaveBeenCalled();
  });

  it('should handle concurrent message processing', async () => {
    setup.composeStateMock.mockImplementation(() => 
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
      team_id: 'team-123'
    }));

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];

    // Process all messages concurrently
    const promises = messages.map(message => postedHandler!(message));
    
    await expect(Promise.all(promises)).resolves.not.toThrow();
    
    // All messages should have been processed
    expect(setup.composeStateMock).toHaveBeenCalledTimes(5);
  });

  it('should handle invalid JSON in post data', async () => {
    const invalidMessage = {
      channel_display_name: 'Direct Message',
      channel_name: 'user__bot',
      channel_type: 'D',
      post: 'invalid json',
      sender_name: 'Test User',
      team_id: 'team-123'
    };

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await expect(postedHandler!(invalidMessage)).resolves.not.toThrow();
    
    // Should not call AI generation for invalid messages
    expect(setup.composeStateMock).not.toHaveBeenCalled();
  });
}); 