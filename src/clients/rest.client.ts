import { Client4 } from '@mattermost/client';
import type { UserProfile, Team, Channel, FileInfo } from '@mattermost/types';
import type { MattermostConfig } from '../config';

/**
 * REST API client for Mattermost operations
 * Wraps the official Mattermost Client4 SDK
 */
export class RestClient {
  private client: Client4;
  private config: MattermostConfig;
  private botUser: UserProfile | null = null;
  private team: Team | null = null;

  constructor(config: MattermostConfig) {
    this.config = config;
    this.client = new Client4();
    
    // Configure the client with our settings
    this.client.setUrl(config.env.MATTERMOST_URL);
    this.client.setToken(config.credentials.mattermostToken);
  }

  /**
   * Validate that credentials work and bot has access
   */
  async validateCredentials(): Promise<void> {
    try {
      // Test basic connectivity by getting bot user info
      this.botUser = await this.client.getMe();
      
      // Validate team access
      this.team = await this.client.getTeamByName(this.config.env.MATTERMOST_TEAM);
      if (!this.team) {
        throw new Error(`Team '${this.config.env.MATTERMOST_TEAM}' not found or not accessible`);
      }
      
    } catch (error) {
      throw new Error(`Failed to validate Mattermost credentials: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get bot user information
   */
  async getBotUser(): Promise<UserProfile> {
    if (!this.botUser) {
      this.botUser = await this.client.getMe();
    }
    return this.botUser;
  }

  /**
   * Get team information
   */
  async getTeam(): Promise<Team> {
    if (!this.team) {
      this.team = await this.client.getTeamByName(this.config.env.MATTERMOST_TEAM);
    }
    if (!this.team) {
      throw new Error(`Team '${this.config.env.MATTERMOST_TEAM}' not found`);
    }
    return this.team;
  }
} 