import { Client4 } from '@mattermost/client';
import type { UserProfile, Team, Channel, FileInfo } from '@mattermost/types';
import type { MattermostConfig } from '../config';
import { createSafeLogger } from '../config/credentials';

/**
 * REST API client for Mattermost operations
 * Wraps the official Mattermost Client4 SDK with configuration integration
 */
export class RestClient {
  private client: Client4;
  private config: MattermostConfig;
  private botUser: UserProfile | null = null;
  private team: Team | null = null;
  private isInitialized = false;
  private logger: any;

  constructor(config: MattermostConfig) {
    this.config = config;
    this.logger = createSafeLogger(console); // Will be enhanced when ElizaOS logger is available
    
    this.validateConfiguration(config);
    this.initializeClient();
  }

  /**
   * Validate configuration before initializing client
   */
  private validateConfiguration(config: MattermostConfig): void {
    if (!config.env.MATTERMOST_URL) {
      throw new Error('MATTERMOST_URL is required in configuration');
    }

    if (!config.credentials.mattermostToken) {
      throw new Error('Mattermost token is required but not found in credentials');
    }

    if (!config.env.MATTERMOST_TEAM) {
      throw new Error('MATTERMOST_TEAM is required in configuration');
    }

    // Validate URL format
    try {
      new URL(config.env.MATTERMOST_URL);
    } catch (error) {
      throw new Error(`Invalid MATTERMOST_URL format: ${config.env.MATTERMOST_URL}`);
    }

    this.logger.info('Configuration validation passed');
  }

  /**
   * Initialize the Mattermost Client4 instance
   */
  private initializeClient(): void {
    try {
      this.client = new Client4();
      
      // Configure the client with our settings
      this.client.setUrl(this.config.env.MATTERMOST_URL);
      this.client.setToken(this.config.credentials.mattermostToken);
      
      // Set additional configuration
      this.client.setUserAgent(`ElizaOS-MattermostPlugin/${this.getBotUsername()}`);
      
      this.logger.info('RestClient initialized successfully', {
        serverUrl: this.config.env.MATTERMOST_URL,
        team: this.config.env.MATTERMOST_TEAM,
        botUsername: this.getBotUsername()
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
      this.logger.error('Failed to initialize RestClient', { error: errorMessage });
      throw new Error(`RestClient initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Get bot username from configuration
   */
  private getBotUsername(): string {
    return this.config.env.MATTERMOST_BOT_USERNAME || 'eliza-bot';
  }

  /**
   * Validate that credentials work and bot has access
   * This is the main initialization method that should be called after construction
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.info('RestClient already initialized');
      return;
    }

    try {
      this.logger.info('Validating credentials and initializing connection...');
      
      // Test basic connectivity by getting bot user info
      this.botUser = await this.client.getMe();
      this.logger.info('Successfully retrieved bot user info', {
        botId: this.botUser.id,
        botUsername: this.botUser.username,
        botDisplayName: this.botUser.first_name || this.botUser.username
      });
      
      // Validate team access
      this.team = await this.client.getTeamByName(this.config.env.MATTERMOST_TEAM);
      if (!this.team) {
        throw new Error(`Team '${this.config.env.MATTERMOST_TEAM}' not found or not accessible`);
      }
      
      this.logger.info('Successfully validated team access', {
        teamId: this.team.id,
        teamName: this.team.name,
        teamDisplayName: this.team.display_name
      });
      
      // Check if bot is a member of the team
      try {
        const teamMember = await this.client.getTeamMember(this.team.id, this.botUser.id);
        this.logger.info('Bot is a member of the team', {
          membershipStatus: teamMember ? 'active' : 'inactive'
        });
      } catch (error) {
        this.logger.warn('Could not verify team membership - bot may need to be added to team');
      }
      
      this.isInitialized = true;
      this.logger.info('RestClient initialization completed successfully');
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown validation error';
      this.logger.error('Failed to validate credentials', { error: errorMessage });
      
      // Provide helpful guidance for common issues
      if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
        throw new Error(`Authentication failed: Invalid bot token. Please verify your MATTERMOST_TOKEN is correct and the bot account is active.`);
      } else if (errorMessage.includes('not found') && errorMessage.includes('team')) {
        throw new Error(`Team access failed: Team '${this.config.env.MATTERMOST_TEAM}' not found. Please verify the team name is correct and the bot has access.`);
      } else if (errorMessage.includes('Network') || errorMessage.includes('timeout')) {
        throw new Error(`Connection failed: Cannot reach Mattermost server at ${this.config.env.MATTERMOST_URL}. Please verify the URL and network connectivity.`);
      } else {
        throw new Error(`Credential validation failed: ${errorMessage}`);
      }
    }
  }

  /**
   * Check if the client is properly initialized and ready for use
   */
  isReady(): boolean {
    return this.isInitialized && !!this.botUser && !!this.team;
  }

  /**
   * Get bot user information
   */
  async getBotUser(): Promise<UserProfile> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }
    
    if (!this.botUser) {
      this.botUser = await this.client.getMe();
    }
    return this.botUser;
  }

  /**
   * Get team information
   */
  async getTeam(): Promise<Team> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }
    
    if (!this.team) {
      this.team = await this.client.getTeamByName(this.config.env.MATTERMOST_TEAM);
      if (!this.team) {
        throw new Error(`Team '${this.config.env.MATTERMOST_TEAM}' not found`);
      }
    }
    return this.team;
  }

  /**
   * Get the underlying Client4 instance for advanced operations
   * Use with caution - prefer the wrapper methods when available
   */
  getClient(): Client4 {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * Get current configuration (safe copy)
   */
  getConfiguration(): Readonly<MattermostConfig> {
    return { ...this.config };
  }

  /**
   * Test the connection without throwing errors
   * Useful for health checks
   */
  async testConnection(): Promise<{ success: boolean, error?: string }> {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }
      
      // Simple test - get bot info
      await this.client.getMe();
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, error: errorMessage };
    }
  }
} 