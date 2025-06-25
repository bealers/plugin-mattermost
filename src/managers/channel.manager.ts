import { IAgentRuntime } from '@elizaos/core';
import { RestClient } from '../clients/rest.client';
import { Channel } from '@mattermost/types';

/**
 * Channel Manager for handling channel operations and membership management
 * 
 * Provides functionality for:
 * - Joining and leaving channels
 * - Permission validation and access control
 * - Channel membership tracking
 * - Multi-channel support
 */
export class ChannelManager {
  private restClient: RestClient;
  private runtime: IAgentRuntime;
  private joinedChannels: Set<string> = new Set();
  private botUserId: string | null = null;
  private teamId: string | null = null;
  private isInitialized = false;
  
  constructor(restClient: RestClient, runtime: IAgentRuntime) {
    this.restClient = restClient;
    this.runtime = runtime;
  }
  
  /**
   * Initialize the channel manager
   * Retrieves bot user ID, team ID, and existing channel memberships
   */
  async initialize(): Promise<void> {
    try {
      // Get bot user ID
      const botUser = await this.restClient.getBotUser();
      this.botUserId = botUser.id;
      
      // Get team ID
      const team = await this.restClient.getTeam();
      this.teamId = team.id;
      
      // Get channels the bot is already a member of
      const channels = await this.restClient.getChannelsForUser(this.botUserId, team.id);
      
      // Track joined channels
      for (const channel of channels) {
        this.joinedChannels.add(channel.id);
      }
      
      this.isInitialized = true;
      this.runtime.logger.info(`Channel manager initialized with ${this.joinedChannels.size} joined channels`);
    } catch (error) {
      this.runtime.logger.error(`Failed to initialize channel manager: ${error.message}`);
      throw new Error(`Channel manager initialization failed: ${error.message}`);
    }
  }
  
  /**
   * Cleanup the channel manager
   */
  async cleanup(): Promise<void> {
    this.joinedChannels.clear();
    this.botUserId = null;
    this.teamId = null;
    this.isInitialized = false;
    this.runtime.logger.info('Channel manager cleaned up');
  }

  /**
   * Join a channel by ID
   * @param channelId - The ID of the channel to join
   * @returns Promise<boolean> - True if successfully joined or already joined
   */
  async joinChannel(channelId: string): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        throw new Error('Channel manager not initialized');
      }

      // Skip if already joined
      if (this.joinedChannels.has(channelId)) {
        this.runtime.logger.debug(`Already joined channel: ${channelId}`);
        return true;
      }
      
      // Get channel info
      const channel = await this.restClient.getChannel(channelId);
      
      // Check channel type
      if (channel.type === 'D' || channel.type === 'G') {
        // Direct and group messages don't need explicit joining
        this.joinedChannels.add(channelId);
        this.runtime.logger.debug(`Added direct/group channel to tracking: ${channelId}`);
        return true;
      }
      
      // Join the channel
      await this.restClient.joinChannel(channelId);
      
      // Track joined channel
      this.joinedChannels.add(channelId);
      
      this.runtime.logger.info(`Joined channel: ${channel.display_name} (${channelId})`);
      return true;
    } catch (error) {
      this.runtime.logger.error(`Error joining channel ${channelId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Join a channel by name
   * @param channelName - The name of the channel to join
   * @returns Promise<boolean> - True if successfully joined or already joined
   */
  async joinChannelByName(channelName: string): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        throw new Error('Channel manager not initialized');
      }

      if (!this.teamId) {
        throw new Error('Team ID not available');
      }

      // Get channel by name
      const channel = await this.restClient.getChannelByName(this.teamId, channelName);
      return await this.joinChannel(channel.id);
    } catch (error) {
      this.runtime.logger.error(`Error joining channel by name ${channelName}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Leave a channel by ID
   * @param channelId - The ID of the channel to leave
   * @returns Promise<boolean> - True if successfully left or not joined
   */
  async leaveChannel(channelId: string): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        throw new Error('Channel manager not initialized');
      }

      // Skip if not joined
      if (!this.joinedChannels.has(channelId)) {
        this.runtime.logger.debug(`Not joined to channel: ${channelId}`);
        return true;
      }
      
      // Get channel info
      const channel = await this.restClient.getChannel(channelId);
      
      // Check channel type
      if (channel.type === 'D' || channel.type === 'G') {
        // Can't leave direct and group messages, but remove from tracking
        this.joinedChannels.delete(channelId);
        this.runtime.logger.debug(`Removed direct/group channel from tracking: ${channelId}`);
        return true;
      }
      
      // Leave the channel
      await this.restClient.leaveChannel(channelId);
      
      // Remove from tracked channels
      this.joinedChannels.delete(channelId);
      
      this.runtime.logger.info(`Left channel: ${channel.display_name} (${channelId})`);
      return true;
    } catch (error) {
      this.runtime.logger.error(`Error leaving channel ${channelId}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Validate if the bot has access to a channel
   * @param channelId - The ID of the channel to validate
   * @returns Promise<boolean> - True if the bot has access to the channel
   */
  async validateChannelAccess(channelId: string): Promise<boolean> {
    try {
      if (!this.isInitialized) {
        throw new Error('Channel manager not initialized');
      }

      // Check if already joined
      if (this.joinedChannels.has(channelId)) {
        return true;
      }
      
      // Try to get channel info
      const channel = await this.restClient.getChannel(channelId);
      
      // If we can get channel info, we have access
      this.runtime.logger.debug(`Validated access to channel: ${channel.display_name} (${channelId})`);
      return true;
    } catch (error) {
      this.runtime.logger.warn(`No access to channel ${channelId}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Get the type of a channel
   * @param channelId - The ID of the channel
   * @returns Promise<string> - The channel type ('O', 'P', 'D', 'G', or 'unknown')
   */
  async getChannelType(channelId: string): Promise<string> {
    try {
      if (!this.isInitialized) {
        throw new Error('Channel manager not initialized');
      }

      const channel = await this.restClient.getChannel(channelId);
      return channel.type;
    } catch (error) {
      this.runtime.logger.error(`Error getting channel type for ${channelId}: ${error.message}`);
      return 'unknown';
    }
  }
  
  /**
   * Check if the bot is joined to a channel
   * @param channelId - The ID of the channel to check
   * @returns boolean - True if the bot is joined to the channel
   */
  isJoined(channelId: string): boolean {
    return this.joinedChannels.has(channelId);
  }

  /**
   * Get all channels the bot is currently joined to
   * @returns string[] - Array of channel IDs
   */
  getJoinedChannels(): string[] {
    return Array.from(this.joinedChannels);
  }

  /**
   * Get the count of joined channels
   * @returns number - Number of channels the bot is joined to
   */
  getJoinedChannelCount(): number {
    return this.joinedChannels.size;
  }

  /**
   * Force refresh of channel memberships from the server
   * @returns Promise<void>
   */
  async refreshMemberships(): Promise<void> {
    try {
      if (!this.isInitialized || !this.botUserId || !this.teamId) {
        throw new Error('Channel manager not properly initialized');
      }

      // Get current channels the bot is a member of
      const channels = await this.restClient.getChannelsForUser(this.botUserId, this.teamId);
      
      // Clear and rebuild the joined channels set
      this.joinedChannels.clear();
      for (const channel of channels) {
        this.joinedChannels.add(channel.id);
      }
      
      this.runtime.logger.info(`Refreshed channel memberships: ${this.joinedChannels.size} channels`);
    } catch (error) {
      this.runtime.logger.error(`Error refreshing channel memberships: ${error.message}`);
      throw error;
    }
  }

  get initialized(): boolean {
    return this.isInitialized;
  }
} 