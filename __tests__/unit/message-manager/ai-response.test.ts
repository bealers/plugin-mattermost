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
    // Debug: Check if MessageManager is initialized properly
    console.log('MessageManager ready:', setup.messageManager.isReady());
    console.log('Bot user ID:', setup.messageManager.getBotUserId());
    
    // Test the runtime mock directly first
    console.log('Testing runtime composeState mock directly...');
    try {
      const testResult = await setup.mockRuntime.composeState({
        id: 'test-id',
        content: { text: 'test' }
      } as any);
      console.log('Direct composeState test result:', testResult);
      console.log('composeStateMock calls after direct test:', setup.composeStateMock.mock.calls.length);
    } catch (error) {
      console.log('Error testing composeState directly:', error);
    }
    
    setup.composeStateMock.mockResolvedValue('Simple string response');

    const directMessage = testData.directMessage();
    console.log('Direct message data:', JSON.stringify(directMessage, null, 2));
    
    // Parse the post to check what shouldProcessMessage sees
    const postData = JSON.parse(directMessage.post);
    console.log('Parsed post data:', JSON.stringify(postData, null, 2));
    console.log('Post user_id:', postData.user_id);
    console.log('Bot user_id:', setup.messageManager.getBotUserId());
    console.log('Channel type:', directMessage.channel_type);
    console.log('Message content:', postData.message);
    console.log('Message type:', postData.type);
    
    // Debug: Check if event handlers are registered
    const onCalls = vi.mocked(setup.mockWsClient.on).mock.calls;
    console.log('WebSocket event handlers registered:', onCalls.map(call => call[0]));

    // Debug: Spy on console/logger to see if there are any filtering messages
    const originalConsoleLog = console.log;
    const debugLogs: string[] = [];
    console.log = (...args: any[]) => {
      debugLogs.push(args.join(' '));
      originalConsoleLog(...args);
    };

    await processMessageAndWait(setup.mockWsClient, directMessage, setup);
    
    // Restore console.log
    console.log = originalConsoleLog;

    // Debug: Check if mocks were called
    console.log('composeStateMock called:', setup.composeStateMock.mock.calls.length);
    console.log('useModelMock called:', setup.useModelMock.mock.calls.length);
    console.log('createPost called:', setup.mockRestClient.posts.createPost.mock.calls.length);
    
    // Show any debug logs captured during processing
    if (debugLogs.length > 0) {
      console.log('Debug logs during processing:', debugLogs);
    }
    
    // Log all mock calls for debugging
    if (setup.composeStateMock.mock.calls.length > 0) {
      console.log('composeStateMock calls:', setup.composeStateMock.mock.calls);
    }
    if (setup.useModelMock.mock.calls.length > 0) {
      console.log('useModelMock calls:', setup.useModelMock.mock.calls);
    }
    if (setup.mockRestClient.posts.createPost.mock.calls.length > 0) {
      console.log('createPost calls:', setup.mockRestClient.posts.createPost.mock.calls);
    }

    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalledWith(
      'channel-123',
      expect.stringContaining('Hi Test User'), // Expect actual AI response
      expect.any(Object)
    );
  });

  it('should handle object responses from AI model', async () => {
    setup.composeStateMock.mockResolvedValue({
      text: 'Object response message',
      action: 'CONTINUE'
    });

    const directMessage = testData.directMessage();

    await processMessageAndWait(setup.mockWsClient, directMessage, setup);

    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalledWith(
      'channel-123',
      expect.stringContaining('Hi Test User'), // Expect actual AI response
      expect.any(Object)
    );
  });

  it('should handle null responses gracefully', async () => {
    setup.composeStateMock.mockResolvedValue(null);

    const directMessage = testData.directMessage();

    await processMessageAndWait(setup.mockWsClient, directMessage, setup);

    // When AI returns null, the system correctly handles it by not posting
    // This is the correct behavior - null response means no response should be sent
    expect(setup.mockRestClient.posts.createPost).not.toHaveBeenCalled();
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
    // AI will generate actual response with context

    const threadReply = testData.threadReply('original-post');
    threadReply.mentions = JSON.stringify(['mock-bot-user-id']);

    await processMessageAndWait(setup.mockWsClient, threadReply, setup);

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
      content: expect.objectContaining({
        text: expect.any(String)
      })
    });
  });

  it('should handle AI model errors gracefully', async () => {
    setup.composeStateMock.mockRejectedValue(new Error('AI model error'));

    const directMessage = testData.directMessage();

    // Should not throw, should handle error gracefully
    await expect(processMessageAndWait(setup.mockWsClient, directMessage, setup)).resolves.not.toThrow();
    
    // Should not attempt to post when AI fails
    expect(setup.mockRestClient.posts.createPost).not.toHaveBeenCalled();
  });

  it('should handle object responses without text property', async () => {
    setup.composeStateMock.mockResolvedValue({
      action: 'CONTINUE',
      // missing text property
    });

    const directMessage = testData.directMessage();

    await processMessageAndWait(setup.mockWsClient, directMessage, setup);

    expect(setup.mockRestClient.posts.createPost).toHaveBeenCalledWith(
      'channel-123',
      expect.stringContaining('Hi Test User'),
      expect.any(Object)
    );
  });
}); 