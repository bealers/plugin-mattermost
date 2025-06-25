import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, processMessageAndWait } from './shared-setup';

describe('MessageManager - Cache Management', () => {
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
      team_id: 'team-123',
      mentions: JSON.stringify(['mock-bot-user-id'])
    };

    setup.composeStateMock.mockResolvedValue('Response to duplicate test');

    // Process the same message twice
    await processMessageAndWait(setup.mockWsClient, message);
    await processMessageAndWait(setup.mockWsClient, message);

    // Should only call AI generation once
    expect(setup.composeStateMock).toHaveBeenCalledTimes(1);
  });

  it('should clear cache when cleanup is called', async () => {
    // This test verifies that cleanup removes cached message IDs
    const message = {
      channel_display_name: 'Direct Message',
      channel_name: 'user__bot',
      channel_type: 'D',
      post: JSON.stringify({
        id: 'cache-test-msg',
        user_id: 'user-123',
        channel_id: 'channel-dm',
        message: 'Cache test message',
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

    setup.composeStateMock.mockResolvedValue('Cache test response');

    // Process message once
    await processMessageAndWait(setup.mockWsClient, message);
    expect(setup.composeStateMock).toHaveBeenCalledTimes(1);

    // Cleanup and reinitialize
    await setup.messageManager.cleanup();
    await setup.messageManager.initialize();

    // Process same message again - should work since cache was cleared
    await processMessageAndWait(setup.mockWsClient, message);
    expect(setup.composeStateMock).toHaveBeenCalledTimes(2);
  });

  it('should provide cache statistics', async () => {
    const stats = setup.messageManager.getCacheStats();
    
    expect(stats).toHaveProperty('processedCount');
    expect(stats).toHaveProperty('maxSize');
    expect(typeof stats.processedCount).toBe('number');
    expect(typeof stats.maxSize).toBe('number');
  });
}); 