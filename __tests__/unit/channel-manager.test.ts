import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { ChannelManager } from '../../src/managers/channel.manager';
import { RestClient } from '../../src/clients/rest.client';
import { IAgentRuntime } from '@elizaos/core';

// Mock the RestClient
vi.mock('../../src/clients/rest.client');

describe('ChannelManager', () => {
  let channelManager: ChannelManager;
  let mockRestClient: jest.Mocked<RestClient>;
  let mockRuntime: jest.Mocked<IAgentRuntime>;

  const mockBotUser = {
    id: 'bot-user-id',
    username: 'test-bot'
  };

  const mockTeam = {
    id: 'team-id',
    name: 'Test Team'
  };

  const mockChannels = [
    {
      id: 'channel-1',
      name: 'public-channel',
      display_name: 'Public Channel',
      type: 'O'
    },
    {
      id: 'channel-2',
      name: 'private-channel',
      display_name: 'Private Channel',
      type: 'P'
    },
    {
      id: 'channel-3',
      name: 'direct-message',
      display_name: 'Direct Message',
      type: 'D'
    },
    {
      id: 'channel-4',
      name: 'group-message',
      display_name: 'Group Message',
      type: 'G'
    }
  ];

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create mock runtime
    mockRuntime = {
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    } as any;

    // Create mock REST client
    mockRestClient = {
      getBotUser: vi.fn().mockResolvedValue(mockBotUser),
      getTeam: vi.fn().mockResolvedValue(mockTeam),
      getChannelsForUser: vi.fn().mockResolvedValue(mockChannels),
      getChannel: vi.fn(),
      getChannelByName: vi.fn(),
      joinChannel: vi.fn(),
      leaveChannel: vi.fn()
    } as any;

    // Create ChannelManager instance
    channelManager = new ChannelManager(mockRestClient, mockRuntime);
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await channelManager.initialize();

      expect(mockRestClient.getBotUser).toHaveBeenCalledOnce();
      expect(mockRestClient.getTeam).toHaveBeenCalledOnce();
      expect(mockRestClient.getChannelsForUser).toHaveBeenCalledWith(mockBotUser.id, mockTeam.id);
      expect(mockRuntime.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Channel manager initialized with 4 joined channels')
      );
      expect(channelManager.initialized).toBe(true);
    });

    it('should handle initialization errors', async () => {
      const error = new Error('API Error');
      mockRestClient.getBotUser.mockRejectedValue(error);

      await expect(channelManager.initialize()).rejects.toThrow('Channel manager initialization failed: API Error');
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize channel manager: API Error')
      );
      expect(channelManager.initialized).toBe(false);
    });

    it('should track initial channel memberships', async () => {
      await channelManager.initialize();

      expect(channelManager.isJoined('channel-1')).toBe(true);
      expect(channelManager.isJoined('channel-2')).toBe(true);
      expect(channelManager.isJoined('channel-3')).toBe(true);
      expect(channelManager.isJoined('channel-4')).toBe(true);
      expect(channelManager.getJoinedChannelCount()).toBe(4);
    });
  });

  describe('Channel Joining', () => {
    beforeEach(async () => {
      await channelManager.initialize();
    });

    it('should join a public channel successfully', async () => {
      const newChannel = { id: 'new-channel', name: 'new-public', display_name: 'New Public', type: 'O' };
      mockRestClient.getChannel.mockResolvedValue(newChannel);
      mockRestClient.joinChannel.mockResolvedValue({});

      const result = await channelManager.joinChannel('new-channel');

      expect(result).toBe(true);
      expect(mockRestClient.getChannel).toHaveBeenCalledWith('new-channel');
      expect(mockRestClient.joinChannel).toHaveBeenCalledWith('new-channel');
      expect(channelManager.isJoined('new-channel')).toBe(true);
      expect(mockRuntime.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Joined channel: New Public (new-channel)')
      );
    });

    it('should join a private channel successfully', async () => {
      const newChannel = { id: 'new-private', name: 'new-private', display_name: 'New Private', type: 'P' };
      mockRestClient.getChannel.mockResolvedValue(newChannel);
      mockRestClient.joinChannel.mockResolvedValue({});

      const result = await channelManager.joinChannel('new-private');

      expect(result).toBe(true);
      expect(mockRestClient.joinChannel).toHaveBeenCalledWith('new-private');
      expect(channelManager.isJoined('new-private')).toBe(true);
    });

    it('should handle direct message channels without API call', async () => {
      const dmChannel = { id: 'new-dm', name: 'dm', display_name: 'Direct Message', type: 'D' };
      mockRestClient.getChannel.mockResolvedValue(dmChannel);

      const result = await channelManager.joinChannel('new-dm');

      expect(result).toBe(true);
      expect(mockRestClient.getChannel).toHaveBeenCalledWith('new-dm');
      expect(mockRestClient.joinChannel).not.toHaveBeenCalled();
      expect(channelManager.isJoined('new-dm')).toBe(true);
      expect(mockRuntime.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Added direct/group channel to tracking: new-dm')
      );
    });

    it('should handle group message channels without API call', async () => {
      const gmChannel = { id: 'new-gm', name: 'gm', display_name: 'Group Message', type: 'G' };
      mockRestClient.getChannel.mockResolvedValue(gmChannel);

      const result = await channelManager.joinChannel('new-gm');

      expect(result).toBe(true);
      expect(mockRestClient.joinChannel).not.toHaveBeenCalled();
      expect(channelManager.isJoined('new-gm')).toBe(true);
    });

    it('should skip joining if already joined', async () => {
      const result = await channelManager.joinChannel('channel-1');

      expect(result).toBe(true);
      expect(mockRestClient.getChannel).not.toHaveBeenCalled();
      expect(mockRestClient.joinChannel).not.toHaveBeenCalled();
      expect(mockRuntime.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Already joined channel: channel-1')
      );
    });

    it('should handle join errors gracefully', async () => {
      const error = new Error('Join failed');
      mockRestClient.getChannel.mockRejectedValue(error);

      const result = await channelManager.joinChannel('error-channel');

      expect(result).toBe(false);
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error joining channel error-channel: Join failed')
      );
      expect(channelManager.isJoined('error-channel')).toBe(false);
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new ChannelManager(mockRestClient, mockRuntime);
      
      const result = await uninitializedManager.joinChannel('test-channel');
      
      expect(result).toBe(false);
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error joining channel test-channel: Channel manager not initialized')
      );
    });
  });

  describe('Channel Joining by Name', () => {
    beforeEach(async () => {
      await channelManager.initialize();
    });

    it('should join channel by name successfully', async () => {
      const channel = { id: 'channel-by-name', name: 'test-channel', display_name: 'Test Channel', type: 'O' };
      mockRestClient.getChannelByName.mockResolvedValue(channel);
      mockRestClient.getChannel.mockResolvedValue(channel);
      mockRestClient.joinChannel.mockResolvedValue({});

      const result = await channelManager.joinChannelByName('test-channel');

      expect(result).toBe(true);
      expect(mockRestClient.getChannelByName).toHaveBeenCalledWith(mockTeam.id, 'test-channel');
      expect(channelManager.isJoined('channel-by-name')).toBe(true);
    });

    it('should handle errors when joining by name', async () => {
      const error = new Error('Channel not found');
      mockRestClient.getChannelByName.mockRejectedValue(error);

      const result = await channelManager.joinChannelByName('nonexistent');

      expect(result).toBe(false);
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error joining channel by name nonexistent: Channel not found')
      );
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new ChannelManager(mockRestClient, mockRuntime);
      
      const result = await uninitializedManager.joinChannelByName('test-channel');
      
      expect(result).toBe(false);
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error joining channel by name test-channel: Channel manager not initialized')
      );
    });
  });

  describe('Channel Leaving', () => {
    beforeEach(async () => {
      await channelManager.initialize();
    });

    it('should leave a public channel successfully', async () => {
      const channel = mockChannels[0]; // Public channel
      mockRestClient.getChannel.mockResolvedValue(channel);
      mockRestClient.leaveChannel.mockResolvedValue({});

      const result = await channelManager.leaveChannel('channel-1');

      expect(result).toBe(true);
      expect(mockRestClient.getChannel).toHaveBeenCalledWith('channel-1');
      expect(mockRestClient.leaveChannel).toHaveBeenCalledWith('channel-1');
      expect(channelManager.isJoined('channel-1')).toBe(false);
      expect(mockRuntime.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Left channel: Public Channel (channel-1)')
      );
    });

    it('should handle direct message channels without API call', async () => {
      const dmChannel = mockChannels[2]; // Direct message
      mockRestClient.getChannel.mockResolvedValue(dmChannel);

      const result = await channelManager.leaveChannel('channel-3');

      expect(result).toBe(true);
      expect(mockRestClient.leaveChannel).not.toHaveBeenCalled();
      expect(channelManager.isJoined('channel-3')).toBe(false);
      expect(mockRuntime.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Removed direct/group channel from tracking: channel-3')
      );
    });

    it('should handle group message channels without API call', async () => {
      const gmChannel = mockChannels[3]; // Group message
      mockRestClient.getChannel.mockResolvedValue(gmChannel);

      const result = await channelManager.leaveChannel('channel-4');

      expect(result).toBe(true);
      expect(mockRestClient.leaveChannel).not.toHaveBeenCalled();
      expect(channelManager.isJoined('channel-4')).toBe(false);
    });

    it('should skip leaving if not joined', async () => {
      const result = await channelManager.leaveChannel('unknown-channel');

      expect(result).toBe(true);
      expect(mockRestClient.getChannel).not.toHaveBeenCalled();
      expect(mockRestClient.leaveChannel).not.toHaveBeenCalled();
      expect(mockRuntime.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Not joined to channel: unknown-channel')
      );
    });

    it('should handle leave errors gracefully', async () => {
      const error = new Error('Leave failed');
      mockRestClient.getChannel.mockRejectedValue(error);

      const result = await channelManager.leaveChannel('channel-1');

      expect(result).toBe(false);
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error leaving channel channel-1: Leave failed')
      );
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new ChannelManager(mockRestClient, mockRuntime);
      
      const result = await uninitializedManager.leaveChannel('test-channel');
      
      expect(result).toBe(false);
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error leaving channel test-channel: Channel manager not initialized')
      );
    });
  });

  describe('Channel Access Validation', () => {
    beforeEach(async () => {
      await channelManager.initialize();
    });

    it('should return true for joined channels', async () => {
      const result = await channelManager.validateChannelAccess('channel-1');

      expect(result).toBe(true);
      expect(mockRestClient.getChannel).not.toHaveBeenCalled();
    });

    it('should validate access for unjoined channels', async () => {
      const channel = { id: 'accessible-channel', name: 'accessible', display_name: 'Accessible', type: 'O' };
      mockRestClient.getChannel.mockResolvedValue(channel);

      const result = await channelManager.validateChannelAccess('accessible-channel');

      expect(result).toBe(true);
      expect(mockRestClient.getChannel).toHaveBeenCalledWith('accessible-channel');
      expect(mockRuntime.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Validated access to channel: Accessible (accessible-channel)')
      );
    });

    it('should return false for inaccessible channels', async () => {
      const error = new Error('No access');
      mockRestClient.getChannel.mockRejectedValue(error);

      const result = await channelManager.validateChannelAccess('inaccessible-channel');

      expect(result).toBe(false);
      expect(mockRuntime.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No access to channel inaccessible-channel: No access')
      );
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new ChannelManager(mockRestClient, mockRuntime);
      
      const result = await uninitializedManager.validateChannelAccess('test-channel');
      
      expect(result).toBe(false);
      expect(mockRuntime.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No access to channel test-channel: Channel manager not initialized')
      );
    });
  });

  describe('Channel Type Detection', () => {
    beforeEach(async () => {
      await channelManager.initialize();
    });

    it('should return correct channel type', async () => {
      const channel = { id: 'test-channel', name: 'test', display_name: 'Test', type: 'O' };
      mockRestClient.getChannel.mockResolvedValue(channel);

      const result = await channelManager.getChannelType('test-channel');

      expect(result).toBe('O');
      expect(mockRestClient.getChannel).toHaveBeenCalledWith('test-channel');
    });

    it('should return "unknown" for errors', async () => {
      const error = new Error('Channel not found');
      mockRestClient.getChannel.mockRejectedValue(error);

      const result = await channelManager.getChannelType('error-channel');

      expect(result).toBe('unknown');
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error getting channel type for error-channel: Channel not found')
      );
    });

    it('should throw error if not initialized', async () => {
      const uninitializedManager = new ChannelManager(mockRestClient, mockRuntime);
      
      const result = await uninitializedManager.getChannelType('test-channel');
      
      expect(result).toBe('unknown');
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error getting channel type for test-channel: Channel manager not initialized')
      );
    });
  });

  describe('Utility Methods', () => {
    beforeEach(async () => {
      await channelManager.initialize();
    });

    it('should check if channel is joined', () => {
      expect(channelManager.isJoined('channel-1')).toBe(true);
      expect(channelManager.isJoined('unknown-channel')).toBe(false);
    });

    it('should return joined channels list', () => {
      const joinedChannels = channelManager.getJoinedChannels();
      
      expect(joinedChannels).toContain('channel-1');
      expect(joinedChannels).toContain('channel-2');
      expect(joinedChannels).toContain('channel-3');
      expect(joinedChannels).toContain('channel-4');
      expect(joinedChannels).toHaveLength(4);
    });

    it('should return joined channel count', () => {
      expect(channelManager.getJoinedChannelCount()).toBe(4);
    });

    it('should return initialized status', () => {
      expect(channelManager.initialized).toBe(true);
    });
  });

  describe('Membership Refresh', () => {
    beforeEach(async () => {
      await channelManager.initialize();
    });

    it('should refresh channel memberships successfully', async () => {
      const newChannels = [
        { id: 'channel-1', name: 'channel-1', display_name: 'Channel 1', type: 'O' },
        { id: 'channel-5', name: 'channel-5', display_name: 'Channel 5', type: 'O' }
      ];
      mockRestClient.getChannelsForUser.mockResolvedValue(newChannels);

      await channelManager.refreshMemberships();

      expect(mockRestClient.getChannelsForUser).toHaveBeenCalledWith(mockBotUser.id, mockTeam.id);
      expect(channelManager.isJoined('channel-1')).toBe(true);
      expect(channelManager.isJoined('channel-5')).toBe(true);
      expect(channelManager.isJoined('channel-2')).toBe(false); // Removed
      expect(channelManager.getJoinedChannelCount()).toBe(2);
      expect(mockRuntime.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Refreshed channel memberships: 2 channels')
      );
    });

    it('should handle refresh errors', async () => {
      const error = new Error('API Error');
      mockRestClient.getChannelsForUser.mockRejectedValue(error);

      await expect(channelManager.refreshMemberships()).rejects.toThrow('API Error');
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error refreshing channel memberships: API Error')
      );
    });

    it('should throw error if not properly initialized', async () => {
      const uninitializedManager = new ChannelManager(mockRestClient, mockRuntime);
      
      await expect(uninitializedManager.refreshMemberships()).rejects.toThrow('Channel manager not properly initialized');
    });
  });

  describe('Cleanup', () => {
    beforeEach(async () => {
      await channelManager.initialize();
    });

    it('should cleanup successfully', async () => {
      await channelManager.cleanup();

      expect(channelManager.initialized).toBe(false);
      expect(channelManager.getJoinedChannelCount()).toBe(0);
      expect(mockRuntime.logger.info).toHaveBeenCalledWith('Channel manager cleaned up');
    });
  });
}); 