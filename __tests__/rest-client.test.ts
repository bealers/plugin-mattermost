import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RestClient } from '../src/clients/rest.client';
import type { MattermostConfig } from '../src/config';
import { Client4 } from '@mattermost/client';

// Mock the Mattermost client
vi.mock('@mattermost/client', () => ({
  Client4: vi.fn(() => ({
    setUrl: vi.fn(),
    setToken: vi.fn(),
    setUserAgent: vi.fn(),
    getMe: vi.fn(),
    getTeamByName: vi.fn(),
    getTeamMember: vi.fn()
  }))
}));

// Mock the config credentials
vi.mock('../src/config/credentials', () => ({
  createSafeLogger: vi.fn((baseLogger) => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }))
}));

describe('RestClient', () => {
  let mockClient: any;
  let validConfig: MattermostConfig;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    
    // Create mock client instance
    mockClient = {
      setUrl: vi.fn(),
      setToken: vi.fn(),
      setUserAgent: vi.fn(),
      getMe: vi.fn(),
      getTeamByName: vi.fn(),
      getTeamMember: vi.fn()
    };
    
    // Mock Client4 constructor to return our mock
    (Client4 as any).mockImplementation(() => mockClient);
    
    // Create valid configuration
    validConfig = {
      env: {
        MATTERMOST_URL: 'https://chat.example.com',
        MATTERMOST_TEAM: 'testteam',
        MATTERMOST_BOT_USERNAME: 'testbot',
        LOG_LEVEL: 'info',
        MATTERMOST_WS_PING_INTERVAL: 30000,
        MATTERMOST_RATE_LIMIT_PER_MINUTE: 60
      },
      runtime: {
        enableMessageLogging: true,
        maxRetries: 3,
        retryDelay: 1000
      },
      credentials: {
        mattermostToken: 'test-token-12345'
      }
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Constructor and Configuration', () => {
    it('should initialize with valid configuration', () => {
      const client = new RestClient(validConfig);
      
      expect(client).toBeDefined();
      expect(Client4).toHaveBeenCalledTimes(1);
      expect(mockClient.setUrl).toHaveBeenCalledWith('https://chat.example.com');
      expect(mockClient.setToken).toHaveBeenCalledWith('test-token-12345');
      expect(mockClient.setUserAgent).toHaveBeenCalledWith('ElizaOS-MattermostPlugin/testbot');
    });

    it('should throw error for missing MATTERMOST_URL', () => {
      const invalidConfig = { ...validConfig };
      delete invalidConfig.env.MATTERMOST_URL;
      
      expect(() => new RestClient(invalidConfig as any)).toThrow('MATTERMOST_URL is required');
    });

    it('should throw error for missing token', () => {
      const invalidConfig = { ...validConfig };
      delete invalidConfig.credentials.mattermostToken;
      
      expect(() => new RestClient(invalidConfig as any)).toThrow('Mattermost token is required');
    });

    it('should throw error for missing team name', () => {
      const invalidConfig = { ...validConfig };
      delete invalidConfig.env.MATTERMOST_TEAM;
      
      expect(() => new RestClient(invalidConfig as any)).toThrow('MATTERMOST_TEAM is required');
    });

    it('should throw error for invalid URL format', () => {
      const invalidConfig = { ...validConfig };
      invalidConfig.env.MATTERMOST_URL = 'not-a-valid-url';
      
      expect(() => new RestClient(invalidConfig as any)).toThrow('Invalid MATTERMOST_URL format');
    });

    it('should use default bot username if not provided', () => {
      const configWithoutUsername = { ...validConfig };
      delete configWithoutUsername.env.MATTERMOST_BOT_USERNAME;
      
      const client = new RestClient(configWithoutUsername);
      expect(mockClient.setUserAgent).toHaveBeenCalledWith('ElizaOS-MattermostPlugin/eliza-bot');
    });
  });

  describe('Initialization', () => {
    let client: RestClient;

    beforeEach(() => {
      client = new RestClient(validConfig);
    });

    it('should initialize successfully with valid credentials', async () => {
      // Mock successful API responses
      const mockBotUser = { id: 'bot123', username: 'testbot', first_name: 'Test' };
      const mockTeam = { id: 'team123', name: 'testteam', display_name: 'Test Team' };
      const mockTeamMember = { user_id: 'bot123', team_id: 'team123' };
      
      mockClient.getMe.mockResolvedValue(mockBotUser);
      mockClient.getTeamByName.mockResolvedValue(mockTeam);
      mockClient.getTeamMember.mockResolvedValue(mockTeamMember);

      await client.initialize();
      
      expect(client.isReady()).toBe(true);
      expect(mockClient.getMe).toHaveBeenCalledTimes(1);
      expect(mockClient.getTeamByName).toHaveBeenCalledWith('testteam');
      expect(mockClient.getTeamMember).toHaveBeenCalledWith('team123', 'bot123');
    });

    it('should handle unauthorized error appropriately', async () => {
      mockClient.getMe.mockRejectedValue(new Error('Unauthorized'));

      await expect(client.initialize()).rejects.toThrow('Authentication failed: Invalid bot token');
    });

    it('should handle team not found error appropriately', async () => {
      const mockBotUser = { id: 'bot123', username: 'testbot' };
      mockClient.getMe.mockResolvedValue(mockBotUser);
      mockClient.getTeamByName.mockResolvedValue(null);

      await expect(client.initialize()).rejects.toThrow('Team access failed');
    });

    it('should handle network errors appropriately', async () => {
      mockClient.getMe.mockRejectedValue(new Error('Network timeout'));

      await expect(client.initialize()).rejects.toThrow('Connection failed');
    });

    it('should not reinitialize if already initialized', async () => {
      // First initialization
      const mockBotUser = { id: 'bot123', username: 'testbot' };
      const mockTeam = { id: 'team123', name: 'testteam', display_name: 'Test Team' };
      
      mockClient.getMe.mockResolvedValue(mockBotUser);
      mockClient.getTeamByName.mockResolvedValue(mockTeam);
      mockClient.getTeamMember.mockResolvedValue({});

      await client.initialize();
      
      // Reset call counts
      vi.clearAllMocks();
      
      // Second initialization should not make API calls
      await client.initialize();
      
      expect(mockClient.getMe).not.toHaveBeenCalled();
      expect(mockClient.getTeamByName).not.toHaveBeenCalled();
    });
  });

  describe('Methods', () => {
    let client: RestClient;

    beforeEach(() => {
      client = new RestClient(validConfig);
    });

    it('should throw error when accessing methods before initialization', async () => {
      await expect(client.getBotUser()).rejects.toThrow('RestClient not initialized');
      await expect(client.getTeam()).rejects.toThrow('RestClient not initialized');
      expect(() => client.getClient()).toThrow('RestClient not initialized');
    });

    it('should return bot user after initialization', async () => {
      const mockBotUser = { id: 'bot123', username: 'testbot' };
      const mockTeam = { id: 'team123', name: 'testteam', display_name: 'Test Team' };
      
      mockClient.getMe.mockResolvedValue(mockBotUser);
      mockClient.getTeamByName.mockResolvedValue(mockTeam);
      mockClient.getTeamMember.mockResolvedValue({});

      await client.initialize();
      
      const botUser = await client.getBotUser();
      expect(botUser).toEqual(mockBotUser);
    });

    it('should return team after initialization', async () => {
      const mockBotUser = { id: 'bot123', username: 'testbot' };
      const mockTeam = { id: 'team123', name: 'testteam', display_name: 'Test Team' };
      
      mockClient.getMe.mockResolvedValue(mockBotUser);
      mockClient.getTeamByName.mockResolvedValue(mockTeam);
      mockClient.getTeamMember.mockResolvedValue({});

      await client.initialize();
      
      const team = await client.getTeam();
      expect(team).toEqual(mockTeam);
    });

    it('should return configuration safely', () => {
      const config = client.getConfiguration();
      
      expect(config).toEqual(validConfig);
      expect(config).not.toBe(validConfig); // Should be a copy
    });

    it('should test connection successfully', async () => {
      const mockBotUser = { id: 'bot123', username: 'testbot' };
      const mockTeam = { id: 'team123', name: 'testteam', display_name: 'Test Team' };
      
      mockClient.getMe.mockResolvedValue(mockBotUser);
      mockClient.getTeamByName.mockResolvedValue(mockTeam);
      mockClient.getTeamMember.mockResolvedValue({});

      const result = await client.testConnection();
      
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should test connection failure', async () => {
      mockClient.getMe.mockRejectedValue(new Error('Connection failed'));

      const result = await client.testConnection();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Credential validation failed: Connection failed');
    });
  });
}); 