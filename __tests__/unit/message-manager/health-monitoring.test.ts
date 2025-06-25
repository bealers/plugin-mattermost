import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup } from './shared-setup';

describe('MessageManager - Health Monitoring', () => {
  let setup: MessageManagerTestSetup;

  beforeEach(async () => {
    setup = await createMessageManagerTestSetup();
    await setup.messageManager.initialize();
  });

  it('should provide health status including metrics and circuit breakers', async () => {
    const health = setup.messageManager.getHealthStatus();
    
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
    const initialHealth = setup.messageManager.getHealthStatus();
    
    // Process a successful message
    setup.composeStateMock.mockResolvedValue('Success response');
    
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

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(message);
    
    const finalHealth = setup.messageManager.getHealthStatus();
    
    expect(finalHealth.successfulResponses).toBeGreaterThan(initialHealth.successfulResponses);
  });
}); 