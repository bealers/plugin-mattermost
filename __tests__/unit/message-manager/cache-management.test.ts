import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup } from './shared-setup';

describe('MessageManager - Cache Management', () => {
  let setup: MessageManagerTestSetup;

  beforeEach(async () => {
    setup = await createMessageManagerTestSetup();
    await setup.messageManager.initialize();
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

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    // Process the same message twice
    await postedHandler!(message);
    await postedHandler!(message);
    
    // Should only call AI generation once
    expect(setup.composeStateMock).toHaveBeenCalledTimes(1);
  });

  it('should provide cache statistics', async () => {
    const stats = setup.messageManager.getCacheStats();
    
    expect(stats).toHaveProperty('processedCount');
    expect(stats).toHaveProperty('maxSize');
    expect(typeof stats.processedCount).toBe('number');
    expect(typeof stats.maxSize).toBe('number');
  });
}); 