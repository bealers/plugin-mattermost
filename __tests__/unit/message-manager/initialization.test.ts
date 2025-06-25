import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup } from './shared-setup';

describe('MessageManager - Initialization and Cleanup', () => {
  let setup: MessageManagerTestSetup;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    setup = createMessageManagerTestSetup();
  });

  afterEach(async () => {
    if (setup.messageManager.isReady()) {
      await setup.messageManager.cleanup();
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid dependencies', async () => {
      expect(setup.messageManager.isReady()).toBe(false);
      
      await setup.messageManager.initialize();
      
      expect(setup.messageManager.isReady()).toBe(true);
      expect(setup.messageManager.getBotUserId()).toBe('mock-bot-user-id');
      expect(setup.mockRestClient.initialize).toHaveBeenCalled();
      expect(setup.mockRestClient.getBotUser).toHaveBeenCalled();
    });

    it('should handle initialization failure gracefully', async () => {
      const mockError = new Error('REST client initialization failed');
      vi.mocked(setup.mockRestClient.initialize).mockRejectedValue(mockError);

      await expect(setup.messageManager.initialize()).rejects.toThrow(
        'MessageManager initialization failed: REST client initialization failed'
      );
      
      expect(setup.messageManager.isReady()).toBe(false);
    });

    it('should not initialize twice', async () => {
      await setup.messageManager.initialize();
      const firstCallCount = vi.mocked(setup.mockRestClient.initialize).mock.calls.length;
      
      await setup.messageManager.initialize();
      const secondCallCount = vi.mocked(setup.mockRestClient.initialize).mock.calls.length;
      
      expect(secondCallCount).toBe(firstCallCount);
    });

    it('should register WebSocket event handlers during initialization', async () => {
      await setup.messageManager.initialize();
      
      expect(setup.mockWsClient.on).toHaveBeenCalledWith('posted', expect.any(Function));
      expect(setup.mockWsClient.on).toHaveBeenCalledWith('post_edited', expect.any(Function));
      expect(setup.mockWsClient.on).toHaveBeenCalledWith('channel_viewed', expect.any(Function));
    });
  });

  describe('Cleanup', () => {
    it('should cleanup properly', async () => {
      await setup.messageManager.initialize();
      
      await setup.messageManager.cleanup();
      
      expect(setup.messageManager.isReady()).toBe(false);
      expect(setup.messageManager.getBotUserId()).toBe(null);
      expect(setup.mockWsClient.off).toHaveBeenCalled();
    });

    it('should handle cleanup errors gracefully', async () => {
      await setup.messageManager.initialize();
      
      const mockError = new Error('Cleanup error');
      vi.mocked(setup.mockWsClient.off).mockImplementation(() => {
        throw mockError;
      });

      // Should not throw, just log the error
      await expect(setup.messageManager.cleanup()).resolves.not.toThrow();
    });
  });
}); 