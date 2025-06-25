import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMessageManagerTestSetup, MessageManagerTestSetup } from './shared-setup';

describe('MessageManager - Initialization and Cleanup', () => {
  let setup: MessageManagerTestSetup;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    setup = createMessageManagerTestSetup();
    
    // Make REST client start as "not ready" so initialize() gets called
    setup.mockRestClient.isReady.mockReturnValue(false);
  });

  afterEach(async () => {
    if (setup.messageManager.isReady()) {
      await setup.messageManager.cleanup();
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully with valid dependencies', async () => {
      expect(setup.messageManager.isReady()).toBe(false);
      
      // Set up mock to simulate real behavior: isReady() becomes true after initialize()
      let isClientReady = false;
      setup.mockRestClient.isReady.mockImplementation(() => isClientReady);
      setup.mockRestClient.initialize.mockImplementation(async () => {
        isClientReady = true;
      });
      
      await setup.messageManager.initialize();
      
      expect(setup.messageManager.isReady()).toBe(true);
      expect(setup.messageManager.getBotUserId()).toBe('mock-bot-user-id');
      expect(setup.mockRestClient.initialize).toHaveBeenCalled();
      expect(setup.mockRestClient.getBotUser).toHaveBeenCalled();
    });

    it('should handle initialization failure gracefully', async () => {
      const mockError = new Error('Initialization failed');
      setup.mockRestClient.initialize.mockRejectedValue(mockError);

      await expect(setup.messageManager.initialize()).rejects.toThrow(
        'MessageManager initialization failed: Initialization failed'
      );
      
      expect(setup.messageManager.isReady()).toBe(false);
    });

    it('should handle missing bot user gracefully', async () => {
      // Set up mock to simulate real behavior
      let isClientReady = false;
      setup.mockRestClient.isReady.mockImplementation(() => isClientReady);
      setup.mockRestClient.initialize.mockImplementation(async () => {
        isClientReady = true;
      });
      setup.mockRestClient.getBotUser.mockResolvedValue(null);

      await expect(setup.messageManager.initialize()).rejects.toThrow(
        'MessageManager initialization failed: Failed to get bot user: Cannot read properties of null (reading \'id\')'
      );
      
      expect(setup.messageManager.isReady()).toBe(false);
    });

    it('should register WebSocket event handlers during initialization', async () => {
      await setup.messageManager.initialize();
      
      expect(setup.mockWsClient.on).toHaveBeenCalledWith('posted', expect.any(Function));
      expect(setup.mockWsClient.on).toHaveBeenCalledWith('post_edited', expect.any(Function));
      expect(setup.mockWsClient.on).toHaveBeenCalledWith('channel_viewed', expect.any(Function));
    });
  });

  describe('Cleanup', () => {
    it('should cleanup successfully', async () => {
      // Initialize first
      let isClientReady = false;
      setup.mockRestClient.isReady.mockImplementation(() => isClientReady);
      setup.mockRestClient.initialize.mockImplementation(async () => {
        isClientReady = true;
      });
      
      await setup.messageManager.initialize();
      expect(setup.messageManager.isReady()).toBe(true);

      // Then cleanup
      await setup.messageManager.cleanup();
      expect(setup.messageManager.isReady()).toBe(false);
    });

    it('should handle cleanup when not initialized', async () => {
      expect(setup.messageManager.isReady()).toBe(false);
      
      // Should not throw when cleaning up non-initialized manager
      await expect(setup.messageManager.cleanup()).resolves.not.toThrow();
      expect(setup.messageManager.isReady()).toBe(false);
    });

    it('should clear internal state on cleanup', async () => {
      // Initialize first
      let isClientReady = false;
      setup.mockRestClient.isReady.mockImplementation(() => isClientReady);
      setup.mockRestClient.initialize.mockImplementation(async () => {
        isClientReady = true;
      });
      
      await setup.messageManager.initialize();
      expect(setup.messageManager.getBotUserId()).toBe('mock-bot-user-id');

      // Cleanup should clear bot user ID
      await setup.messageManager.cleanup();
      expect(setup.messageManager.getBotUserId()).toBeNull();
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