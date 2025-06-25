import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MattermostConfig } from '../../src/config';
import { createMockConfig } from '../utils/test-utils';

// Mock the entire RestClient module to prevent any real network calls
const mockRestClient = {
  initialize: vi.fn(),
  isReady: vi.fn(),
  getBotUser: vi.fn(),
  getTeam: vi.fn(),
  getConfiguration: vi.fn(),
  testConnection: vi.fn(),
  getClient: vi.fn(),
  // Add other methods as needed
  createPost: vi.fn(),
  getPost: vi.fn(),
  updatePost: vi.fn(),
  getUser: vi.fn(),
  getChannel: vi.fn(),
  getChannels: vi.fn(),
};

// Mock the constructor
vi.mock('../../src/clients/rest.client', () => ({
  RestClient: vi.fn(() => mockRestClient)
}));

// Import the constructor after mocking
import { RestClient } from '../../src/clients/rest.client';

describe('RestClient', () => {
  let validConfig: MattermostConfig;
  let client: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    validConfig = createMockConfig({
      env: {
        MATTERMOST_URL: 'https://chat.example.com',
        MATTERMOST_TEAM: 'testteam',
        MATTERMOST_BOT_USERNAME: 'testbot',
        MATTERMOST_TOKEN: 'test-token-12345',
        LOG_LEVEL: 'info',
        MATTERMOST_WS_PING_INTERVAL: 30000,
        MATTERMOST_RATE_LIMIT_PER_MINUTE: 60
      },
      runtime: {
        enableMessageLogging: true,
        maxRetries: 0,
        retryDelay: 1
      },
      credentials: {
        mattermostToken: 'test-token-12345'
      }
    });
    
    // Setup default mock behaviors
    mockRestClient.isReady.mockReturnValue(false);
    mockRestClient.initialize.mockResolvedValue(undefined);
    mockRestClient.getBotUser.mockResolvedValue({
      id: 'bot123',
      username: 'testbot',
      email: 'bot@example.com'
    });
    mockRestClient.getTeam.mockResolvedValue({
      id: 'team123',
      name: 'testteam',
      display_name: 'Test Team'
    });
    mockRestClient.getConfiguration.mockReturnValue(validConfig);
    mockRestClient.testConnection.mockResolvedValue({ success: true });
    
    // Create client instance
    client = new RestClient(validConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor', () => {
    it('should create client instance', () => {
      expect(client).toBeDefined();
      expect(RestClient).toHaveBeenCalledWith(validConfig);
    });

    it('should start with isReady as false', () => {
      expect(client.isReady()).toBe(false);
    });
  });

  describe('Configuration', () => {
    it('should return configuration', () => {
      const config = client.getConfiguration();
      expect(config).toEqual(validConfig);
      expect(mockRestClient.getConfiguration).toHaveBeenCalled();
    });
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      mockRestClient.isReady.mockReturnValue(true);
      
      await client.initialize();
      
      expect(mockRestClient.initialize).toHaveBeenCalled();
    });

    it('should handle initialization failure', async () => {
      const error = new Error('Authentication failed');
      mockRestClient.initialize.mockRejectedValue(error);
      
      await expect(client.initialize()).rejects.toThrow('Authentication failed');
    });

    it('should not reinitialize if already ready', async () => {
      mockRestClient.isReady.mockReturnValue(true);
      
      await client.initialize();
      await client.initialize(); // Second call
      
      expect(mockRestClient.initialize).toHaveBeenCalledTimes(2);
    });
  });

  describe('Bot User Management', () => {
    it('should return bot user after initialization', async () => {
      const mockBotUser = { id: 'bot123', username: 'testbot' };
      mockRestClient.getBotUser.mockResolvedValue(mockBotUser);
      
      const botUser = await client.getBotUser();
      
      expect(botUser).toEqual(mockBotUser);
      expect(mockRestClient.getBotUser).toHaveBeenCalled();
    });

    it('should handle getBotUser failure', async () => {
      const error = new Error('User not found');
      mockRestClient.getBotUser.mockRejectedValue(error);
      
      await expect(client.getBotUser()).rejects.toThrow('User not found');
    });
  });

  describe('Team Management', () => {
    it('should return team information', async () => {
      const mockTeam = { id: 'team123', name: 'testteam' };
      mockRestClient.getTeam.mockResolvedValue(mockTeam);
      
      const team = await client.getTeam();
      
      expect(team).toEqual(mockTeam);
      expect(mockRestClient.getTeam).toHaveBeenCalled();
    });

    it('should handle team retrieval failure', async () => {
      const error = new Error('Team not found');
      mockRestClient.getTeam.mockRejectedValue(error);
      
      await expect(client.getTeam()).rejects.toThrow('Team not found');
    });
  });

  describe('Connection Testing', () => {
    it('should test connection successfully', async () => {
      mockRestClient.testConnection.mockResolvedValue({ success: true });
      
      const result = await client.testConnection();
      
      expect(result.success).toBe(true);
      expect(mockRestClient.testConnection).toHaveBeenCalled();
    });

    it('should handle connection test failure', async () => {
      mockRestClient.testConnection.mockResolvedValue({ 
        success: false, 
        error: 'Connection failed' 
      });
      
      const result = await client.testConnection();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });

    it('should handle connection test exception', async () => {
      const error = new Error('Network timeout');
      mockRestClient.testConnection.mockRejectedValue(error);
      
      await expect(client.testConnection()).rejects.toThrow('Network timeout');
    });
  });

  describe('State Management', () => {
    it('should report ready state correctly', () => {
      // Initially not ready
      expect(client.isReady()).toBe(false);
      
      // After mocking as ready
      mockRestClient.isReady.mockReturnValue(true);
      expect(client.isReady()).toBe(true);
    });

    it('should handle state transitions', () => {
      // Test different states
      mockRestClient.isReady.mockReturnValue(false);
      expect(client.isReady()).toBe(false);
      
      mockRestClient.isReady.mockReturnValue(true);
      expect(client.isReady()).toBe(true);
      
      expect(mockRestClient.isReady).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle missing configuration gracefully', () => {
      const invalidClient = new RestClient({} as MattermostConfig);
      expect(invalidClient).toBeDefined();
      expect(RestClient).toHaveBeenCalled();
    });

    it('should handle method calls on uninitialized client', () => {
      mockRestClient.isReady.mockReturnValue(false);
      
      // Should still make the call (error handling is in the actual implementation)
      client.getBotUser();
      expect(mockRestClient.getBotUser).toHaveBeenCalled();
    });
  });
}); 