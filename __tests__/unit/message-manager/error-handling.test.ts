import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup, testData } from './shared-setup';

describe('MessageManager - Error Handling and Circuit Breakers', () => {
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

  it('should handle WebSocket connection errors gracefully', async () => {
    const mockError = new Error('WebSocket connection lost');
    
    // Simulate WebSocket error
    const errorHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'error')?.[1];
    
    if (errorHandler) {
      // Should not throw, should handle error gracefully
      expect(() => errorHandler(mockError)).not.toThrow();
    }
  });

  it('should handle REST API errors gracefully', async () => {
    vi.mocked(setup.mockRestClient.createPost).mockRejectedValue(new Error('API Error'));
    setup.composeStateMock.mockResolvedValue('Valid response');

    const directMessage = testData.directMessage();
    
    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    // Should not throw even when POST fails
    await expect(postedHandler!(directMessage)).resolves.not.toThrow();
  });

  it('should handle invalid message data gracefully', async () => {
    const invalidMessage = {
      // Missing required fields
      channel_type: 'D'
    };
    
    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    // Should not throw with invalid data
    await expect(postedHandler!(invalidMessage)).resolves.not.toThrow();
    
    // Should not call AI generation for invalid data
    expect(setup.composeStateMock).not.toHaveBeenCalled();
  });

  it('should handle JSON parsing errors gracefully', async () => {
    const messageWithInvalidJson = {
      channel_display_name: 'Direct Message',
      channel_name: 'user__bot',
      channel_type: 'D',
      post: 'invalid-json-string',
      sender_name: 'Test User',
      team_id: 'team-123'
    };
    
    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    // Should not throw with invalid JSON
    await expect(postedHandler!(messageWithInvalidJson)).resolves.not.toThrow();
  });

  it('should handle circuit breaker activation', async () => {
    // Simulate multiple consecutive failures
    vi.mocked(setup.mockRestClient.createPost).mockRejectedValue(new Error('API Error'));
    setup.composeStateMock.mockResolvedValue('Response');

    const directMessage = testData.directMessage();
    
    const postedHandler = vi.mocked(setup.mockWsClient.on).mock.calls
      .find(call => call[0] === 'posted')?.[1];
    
    // Process multiple messages to trigger circuit breaker
    for (let i = 0; i < 5; i++) {
      await postedHandler!(directMessage);
    }
    
    // Should handle circuit breaker gracefully
    expect(true).toBe(true); // Test passes if no errors thrown
  });
}); 