import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, testData } from './shared-setup';

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

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(directMessage);
    
    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalledWith(
      'channel-123',
      'Simple string response',
      { rootId: 'msg-1' }
    );
  });

  it('should handle object responses from AI model', async () => {
    setup.composeStateMock.mockResolvedValue({ message: 'Object response message' });

    const directMessage = testData.directMessage();

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(directMessage);
    
    expect(setup.mockRestClient.createPost).toHaveBeenCalledWith(
      'channel-123',
      'Object response message',
      { rootId: 'msg-1' }
    );
  });

  it('should handle null/undefined responses from AI model', async () => {
    setup.composeStateMock.mockResolvedValue(null);

    const directMessage = testData.directMessage();

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(directMessage);
    
    // Should not attempt to post when response is null
    expect(setup.mockRestClient.createPost).not.toHaveBeenCalled();
    expect(setup.mockRestClient.posts.createPost).not.toHaveBeenCalled();
  });

  it('should handle AI model errors gracefully', async () => {
    setup.composeStateMock.mockRejectedValue(new Error('AI model error'));

    const directMessage = testData.directMessage();

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    // Should not throw, should handle error gracefully
    await expect(postedHandler!(directMessage)).resolves.not.toThrow();
    
    // Should not attempt to post when AI fails
    expect(setup.mockRestClient.createPost).not.toHaveBeenCalled();
  });

  it('should include thread context in AI generation for replies', async () => {
    const mockThreadPosts = {
      posts: {
        'root-post': {
          id: 'root-post',
          user_id: 'user-456',
          message: 'Original message',
          create_at: Date.now() - 60000,
          user_display_name: 'Original User'
        }
      }
    };

    vi.mocked(setup.mockRestClient.getPostsAroundPost).mockResolvedValue(mockThreadPosts);
    setup.composeStateMock.mockResolvedValue('Thread-aware response');

    const threadReply = testData.threadReply('root-post');
    threadReply.mentions = JSON.stringify(['mock-bot-user-id']);

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    await postedHandler!(threadReply);
    
    // Should call composeState with thread context
    expect(setup.composeStateMock).toHaveBeenCalled();
    const composeStateCall = setup.composeStateMock.mock.calls[0];
    expect(composeStateCall[0]).toMatchObject({
      agentName: expect.any(String),
      recentMessagesData: expect.arrayContaining([
        expect.objectContaining({
          userId: 'user-456',
          content: 'Original message'
        })
      ])
    });
  });

  it('should handle response posting errors gracefully', async () => {
    setup.composeStateMock.mockResolvedValue('Valid response');
    vi.mocked(setup.mockRestClient.createPost).mockRejectedValue(new Error('Post creation failed'));

    const directMessage = testData.directMessage();

    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    // Should not throw, should handle post error gracefully
    await expect(postedHandler!(directMessage)).resolves.not.toThrow();
  });
}); 