import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, testData, processMessageAndWait } from './shared-setup';

describe('MessageManager - AI Response Generation', () => {
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

  it('should handle string responses from AI model', async () => {
    setup.composeStateMock.mockResolvedValue('Simple string response');

    const directMessage = testData.directMessage();

    await processMessageAndWait(setup.mockWsClient, directMessage);

    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalledWith(
      'channel-123',
      'Simple string response',
      expect.any(Object)
    );
  });

  it('should handle object responses from AI model', async () => {
    setup.composeStateMock.mockResolvedValue({
      text: 'Object response message',
      action: 'CONTINUE'
    });

    const directMessage = testData.directMessage();

    await processMessageAndWait(setup.mockWsClient, directMessage);

    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalledWith(
      'channel-123',
      'Object response message',
      expect.any(Object)
    );
  });

  it('should handle null responses gracefully', async () => {
    setup.composeStateMock.mockResolvedValue(null);

    const directMessage = testData.directMessage();

    await processMessageAndWait(setup.mockWsClient, directMessage);

    // Should post a fallback message when AI returns null
    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalledWith(
      'channel-123',
      expect.stringContaining('having trouble generating a response'),
      expect.any(Object)
    );
  });

  it('should include thread context in AI generation for replies', async () => {
    const mockThreadContext = {
      posts: [
        {
          id: 'original-post',
          user_id: 'other-user',
          message: 'Original message in thread',
          create_at: Date.now() - 10000,
          username: 'OtherUser'
        },
        {
          id: 'reply-1',
          user_id: 'another-user',
          message: 'First reply',
          create_at: Date.now() - 5000,
          root_id: 'original-post',
          username: 'AnotherUser'
        }
      ],
      messageCount: 2,
      participantCount: 2,
      lastActivity: new Date(Date.now() - 5000),
      isActive: true
    };

    setup.mockRestClient.threads.getThreadContext.mockResolvedValue(mockThreadContext);
    setup.composeStateMock.mockResolvedValue('Reply with context');

    const threadReply = testData.threadReply('original-post');
    threadReply.mentions = JSON.stringify(['mock-bot-user-id']);

    await processMessageAndWait(setup.mockWsClient, threadReply);

    // Should call getThreadContext for thread replies
    expect(setup.mockRestClient.threads.getThreadContext).toHaveBeenCalledWith(
      'original-post',
      'channel-123',
      expect.any(Object)
    );

    // Should call composeState with thread context
    expect(setup.composeStateMock).toHaveBeenCalled();
    const composeStateCall = setup.composeStateMock.mock.calls[0];
    expect(composeStateCall[0]).toMatchObject({
      agentId: expect.any(String),
      roomId: expect.any(String),
      userId: expect.any(String),
      content: expect.objectContaining({
        text: expect.any(String)
      })
    });
  });

  it('should handle AI model errors gracefully', async () => {
    setup.composeStateMock.mockRejectedValue(new Error('AI model error'));

    const directMessage = testData.directMessage();

    // Should not throw, should handle error gracefully
    await expect(processMessageAndWait(setup.mockWsClient, directMessage)).resolves.not.toThrow();
    
    // Should not attempt to post when AI fails
    expect(setup.mockRestClient.posts.createPost).not.toHaveBeenCalled();
  });

  it('should handle object responses without text property', async () => {
    setup.composeStateMock.mockResolvedValue({
      action: 'CONTINUE',
      // missing text property
    });

    const directMessage = testData.directMessage();

    await processMessageAndWait(setup.mockWsClient, directMessage);

    // Should post a fallback message when object has no text
    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalledWith(
      'channel-123',
      expect.stringContaining('having trouble generating a response'),
      expect.any(Object)
    );
  });
}); 