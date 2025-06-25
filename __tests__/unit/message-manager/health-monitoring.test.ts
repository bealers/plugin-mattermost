import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, processMessageAndWait } from './shared-setup';

describe('MessageManager - Health Monitoring', () => {
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

  it('should provide health status including metrics and circuit breakers', async () => {
    const health = setup.messageManager.getHealthStatus();
    
    expect(health).toHaveProperty('totalMessages');
    expect(health).toHaveProperty('successfulResponses');
    expect(health).toHaveProperty('failedResponses');
    expect(health).toHaveProperty('averageResponseTime');
    expect(health).toHaveProperty('circuitBreakers');
    expect(typeof health.totalMessages).toBe('number');
    expect(typeof health.successfulResponses).toBe('number');
    expect(typeof health.failedResponses).toBe('number');
  });

  it('should track success and failure metrics', async () => {
    const initialHealth = setup.messageManager.getHealthStatus();
    
    setup.composeStateMock.mockResolvedValue('Success response');

    const message = {
      channel_display_name: 'Direct Message',
      channel_name: 'user__bot',
      channel_type: 'D',
      post: JSON.stringify({
        id: 'health-test-msg',
        user_id: 'user-123',
        channel_id: 'channel-dm',
        message: 'Health test message',
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

    // Process a successful message
    await processMessageAndWait(setup.mockWsClient, message);
    
    const finalHealth = setup.messageManager.getHealthStatus();
    
    expect(finalHealth.successfulResponses).toBeGreaterThan(initialHealth.successfulResponses);
  });
}); 