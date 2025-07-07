import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, processMessageAndWait, testData } from './shared-setup';

describe('MessageManager - Message Filtering', () => {
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

  it('should process direct messages', async () => {
    const directMessage = testData.directMessage();

    // Process message and wait for completion
    await processMessageAndWait(setup.mockWsClient, directMessage);
    
    // Should call AI generation
    expect(setup.composeStateMock).toHaveBeenCalled();
  });

  it('should process mentions in public channels', async () => {
    const mentionMessage = {
      channel_display_name: 'General',
      channel_name: 'general',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'msg-2',
        user_id: 'user-456',
        channel_id: 'channel-general',
        message: '@bot help me',
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

    const postedHandler = (setup.mockWsClient.on as any).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(mentionMessage);
    
    // Wait for async processing
    await new Promise(resolve => setImmediate(resolve));
    
    expect(setup.composeStateMock).toHaveBeenCalled();
  });

  it('should skip bot\'s own messages', async () => {
    const botMessage = testData.botMessage();

    const postedHandler = (setup.mockWsClient.on as any).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(botMessage);
    
    // Should not call AI generation for bot's own message
    expect(setup.composeStateMock).not.toHaveBeenCalled();
  });

  it('should skip public channel messages without mentions', async () => {
    const publicMessage = {
      channel_display_name: 'General',
      channel_name: 'general',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'msg-4',
        user_id: 'user-789',
        channel_id: 'channel-general',
        message: 'Just a regular message',
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

    const postedHandler = (setup.mockWsClient.on as any).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(publicMessage);
    
    // Should not call AI generation for non-mentioned public message
    expect(setup.composeStateMock).not.toHaveBeenCalled();
  });

  it('should skip system messages', async () => {
    const systemMessage = {
      channel_display_name: 'General',
      channel_name: 'general',
      channel_type: 'O',
      post: JSON.stringify({
        id: 'msg-5',
        user_id: 'user-123',
        channel_id: 'channel-general',
        message: '',
        create_at: Date.now(),
        update_at: Date.now(),
        type: 'system_join_channel',
        props: {},
        hashtags: '',
        pending_post_id: '',
        reply_count: 0,
        last_reply_at: 0,
        participants: null,
        is_following: false,
        channel_mentions: []
      }),
      sender_name: 'System',
      team_id: 'team-123'
    };

    const postedHandler = (setup.mockWsClient.on as any).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(systemMessage);
    
    expect(setup.composeStateMock).not.toHaveBeenCalled();
  });
}); 