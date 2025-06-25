import MattermostClient from '@mattermost/client';
const { Client4 } = MattermostClient;
// Use any for types that may not be properly exported - focus on functionality first
type UserProfile = any;
type Team = any; 
type Channel = any;
type FileInfo = any;
import type { MattermostConfig } from '../config';
import { createSafeLogger } from '../config/credentials';
import { getMattermostToken } from '../config';

// ============================================================================
// RETRY AND RATE LIMITING UTILITIES
// ============================================================================

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  exponentialBase?: number;
  retryableErrors?: string[];
}

interface RateLimitState {
  requestCount: number;
  windowStart: number;
  rateLimitReset?: number;
  remainingRequests?: number;
}

class RateLimiter {
  private static instance: RateLimiter;
  private state: RateLimitState = {
    requestCount: 0,
    windowStart: Date.now()
  };
  
  // Mattermost API limits: typically 10 requests per second per user
  private readonly maxRequestsPerSecond = 10;
  private readonly windowMs = 1000;

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  async checkRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Reset window if enough time has passed
    if (now - this.state.windowStart >= this.windowMs) {
      this.state.requestCount = 0;
      this.state.windowStart = now;
    }

    // Check if we're over the limit
    if (this.state.requestCount >= this.maxRequestsPerSecond) {
      const waitTime = this.windowMs - (now - this.state.windowStart);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        // Reset after waiting
        this.state.requestCount = 0;
        this.state.windowStart = Date.now();
      }
    }

    this.state.requestCount++;
  }

  updateFromHeaders(headers: any): void {
    if (headers) {
      if (headers['x-ratelimit-remaining']) {
        this.state.remainingRequests = parseInt(headers['x-ratelimit-remaining']);
      }
      if (headers['x-ratelimit-reset']) {
        this.state.rateLimitReset = parseInt(headers['x-ratelimit-reset']) * 1000; // Convert to ms
      }
    }
  }
}

/**
 * Enhanced error class for Mattermost API errors
 */
class MattermostApiError extends Error {
  public readonly statusCode?: number;
  public readonly retryable: boolean;
  public readonly originalError: any;

  constructor(message: string, statusCode?: number, originalError?: any) {
    super(message);
    this.name = 'MattermostApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
    
    // Determine if error is retryable
    this.retryable = this.isRetryableError(statusCode, message);
  }

  private isRetryableError(statusCode?: number, message?: string): boolean {
    // Retryable HTTP status codes
    const retryableStatusCodes = [429, 500, 502, 503, 504];
    
    if (statusCode && retryableStatusCodes.includes(statusCode)) {
      return true;
    }

    // Retryable error messages
    const retryableMessages = [
      'network',
      'timeout',
      'connection',
      'temporarily unavailable',
      'rate limit'
    ];

    if (message) {
      const lowerMessage = message.toLowerCase();
      return retryableMessages.some(msg => lowerMessage.includes(msg));
    }

    return false;
  }
}

/**
 * Execute a function with retry logic and exponential backoff
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  logger: any,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    exponentialBase = 2
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Apply rate limiting before each attempt
      await RateLimiter.getInstance().checkRateLimit();
      
      const result = await operation();
      
      if (attempt > 0) {
        logger.info(`${operationName} succeeded after ${attempt} retries`);
      }
      
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if this is our last attempt
      if (attempt === maxRetries) {
        logger.error(`${operationName} failed after ${maxRetries} retries`, lastError, {
          errorMessage: lastError.message,
          attempt: attempt + 1
        });
        break;
      }

      // Determine if we should retry
      const apiError = lastError instanceof MattermostApiError ? lastError : 
        new MattermostApiError(lastError.message, undefined, lastError);

      if (!apiError.retryable) {
        logger.error(`${operationName} failed with non-retryable error`, lastError, {
          errorMessage: lastError.message,
          attempt: attempt + 1
        });
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        baseDelay * Math.pow(exponentialBase, attempt),
        maxDelay
      );

      logger.warn(`${operationName} failed, retrying in ${delay}ms`, {
        error: lastError.message,
        attempt: attempt + 1,
        maxRetries,
        delay
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // If we get here, all retries failed
  throw new MattermostApiError(
    `Operation ${operationName} failed after ${maxRetries} retries: ${lastError.message}`,
    lastError instanceof MattermostApiError ? lastError.statusCode : undefined,
    lastError
  );
}

/**
 * REST API client for Mattermost operations
 * Wraps the official Mattermost Client4 SDK with configuration integration
 */
export class RestClient {
  private client: InstanceType<typeof Client4>;
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

    try {
      getMattermostToken(); // This will throw if token is not available
    } catch (error) {
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
      this.client.setToken(getMattermostToken());
      
      // Set additional configuration
      this.client.setUserAgent(`ElizaOS-MattermostPlugin/${this.getBotUsername()}`);
      
      this.logger.info('RestClient initialized successfully', {
        serverUrl: this.config.env.MATTERMOST_URL,
        team: this.config.env.MATTERMOST_TEAM,
        botUsername: this.getBotUsername()
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
      const errorObj = error instanceof Error ? error : new Error(errorMessage);
      this.logger.error('Failed to initialize RestClient', errorObj, { errorMessage });
      throw new Error(`RestClient initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Get the bot username from configuration or environment
   */
  private getBotUsername(): string {
    return this.config.env.MATTERMOST_BOT_USERNAME || 'eliza-bot';
  }

  /**
   * Create a standardized API error with proper typing and context
   */
  private createApiError(error: any, contextMessage: string): MattermostApiError {
    let statusCode: number | undefined;
    let originalMessage = 'Unknown error';

    if (error) {
      // Extract status code from various error formats
      if (error.status_code) {
        statusCode = error.status_code;
      } else if (error.statusCode) {
        statusCode = error.statusCode;
      } else if (error.response?.status) {
        statusCode = error.response.status;
      }

      // Extract error message
      if (error.message) {
        originalMessage = error.message;
      } else if (error.detailed_error) {
        originalMessage = error.detailed_error;
      } else if (typeof error === 'string') {
        originalMessage = error;
      }
    }

    const fullMessage = `${contextMessage}: ${originalMessage}`;
    return new MattermostApiError(fullMessage, statusCode, error);
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
      const errorObj = error instanceof Error ? error : new Error(errorMessage);
      this.logger.error('Failed to validate credentials', errorObj, { errorMessage });
      
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
  getClient(): InstanceType<typeof Client4> {
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

  // ============================================================================
  // CHANNEL OPERATIONS
  // ============================================================================

  /**
   * Get channel information by ID
   */
  async getChannel(channelId: string): Promise<Channel> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const channel = await this.client.getChannel(channelId);
          this.logger.info('Retrieved channel info', { 
            channelId, 
            channelName: channel.name,
            channelType: channel.type 
          });
          return channel;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to get channel ${channelId}`);
          this.logger.error('Failed to get channel', { channelId, error: apiError.message });
          throw apiError;
        }
      },
      'getChannel',
      this.logger
    );
  }

  /**
   * Get channel by name within the configured team
   */
  async getChannelByName(channelName: string): Promise<Channel> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const team = await this.getTeam();
          const channel = await this.client.getChannelByName(team.id, channelName);
          this.logger.info('Retrieved channel by name', { 
            channelName, 
            channelId: channel.id,
            teamId: team.id 
          });
          return channel;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to get channel '${channelName}'`);
          this.logger.error('Failed to get channel by name', { channelName, error: apiError.message });
          throw apiError;
        }
      },
      'getChannelByName',
      this.logger
    );
  }

  /**
   * Join a channel
   */
  async joinChannel(channelId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const botUser = await this.getBotUser();
          await this.client.addToChannel(botUser.id, channelId);
          this.logger.info('Successfully joined channel', { 
            channelId, 
            botUserId: botUser.id,
            botUsername: botUser.username 
          });
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to join channel ${channelId}`);
          this.logger.error('Failed to join channel', { channelId, error: apiError.message });
          throw apiError;
        }
      },
      'joinChannel',
      this.logger
    );
  }

  /**
   * Leave a channel
   */
  async leaveChannel(channelId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const botUser = await this.getBotUser();
          await this.client.removeFromChannel(botUser.id, channelId);
          this.logger.info('Successfully left channel', { 
            channelId, 
            botUserId: botUser.id,
            botUsername: botUser.username 
          });
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to leave channel ${channelId}`);
          this.logger.error('Failed to leave channel', { channelId, error: apiError.message });
          throw apiError;
        }
      },
      'leaveChannel',
      this.logger
    );
  }

  /**
   * Get all channels for the configured team
   */
  async getChannelsForTeam(): Promise<Channel[]> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const team = await this.getTeam();
          // Use getChannels method with teamId parameter
          const channels = await this.client.getChannels(team.id);
          this.logger.info('Retrieved team channels', { 
            teamId: team.id,
            teamName: team.name,
            channelCount: channels.length 
          });
          return channels;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to get team channels`);
          this.logger.error('Failed to get team channels', { error: apiError.message });
          throw apiError;
        }
      },
      'getChannelsForTeam',
      this.logger
    );
  }

  /**
   * Get channel members
   */
  async getChannelMembers(channelId: string): Promise<any[]> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const members = await this.client.getChannelMembers(channelId);
          this.logger.info('Retrieved channel members', { 
            channelId, 
            memberCount: members.length 
          });
          return members;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to get channel members for ${channelId}`);
          this.logger.error('Failed to get channel members', { channelId, error: apiError.message });
          throw apiError;
        }
      },
      'getChannelMembers',
      this.logger
    );
  }

  /**
   * Search for channels in the team
   */
  async searchChannels(searchTerm: string): Promise<Channel[]> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const team = await this.getTeam();
          const channels = await this.client.searchChannels(team.id, searchTerm);
          this.logger.info('Searched channels', { 
            teamId: team.id,
            searchTerm, 
            resultCount: channels.length 
          });
          return channels;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to search channels with term '${searchTerm}'`);
          this.logger.error('Failed to search channels', { searchTerm, error: apiError.message });
          throw apiError;
        }
      },
      'searchChannels',
      this.logger
    );
  }

  // ============================================================================
  // MESSAGE OPERATIONS
  // ============================================================================

  /**
   * Create a new post/message in a channel
   */
  async createPost(channelId: string, message: string, options?: {
    rootId?: string;
    fileIds?: string[];
    props?: Record<string, any>;
  }): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const post = {
            channel_id: channelId,
            message: message,
            root_id: options?.rootId,
            file_ids: options?.fileIds,
            props: options?.props
          };

          const createdPost = await this.client.createPost(post);
          this.logger.info('Created post', { 
            channelId, 
            postId: createdPost.id,
            messageLength: message.length,
            isReply: !!options?.rootId
          });
          return createdPost;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to create post in channel ${channelId}`);
          this.logger.error('Failed to create post', { channelId, error: apiError.message });
          throw apiError;
        }
      },
      'createPost',
      this.logger
    );
  }

  /**
   * Update an existing post
   * TEMPORARILY DISABLED - API method signature issue
   */
  // async updatePost(postId: string, message: string, options?: {
  //   props?: Record<string, any>;
  // }): Promise<any> {
  //   if (!this.isInitialized) {
  //     throw new Error('RestClient not initialized. Call initialize() first.');
  //   }

  //   return withRetry(
  //     async () => {
  //       try {
  //         const post = {
  //           id: postId,
  //           message: message,
  //           props: options?.props
  //         };

  //         const updatedPost = await this.client.updatePost(post);
  //         this.logger.info('Updated post', { 
  //           postId, 
  //           messageLength: message.length 
  //         });
  //         return updatedPost;
  //       } catch (error) {
  //         const apiError = this.createApiError(error, `Failed to update post ${postId}`);
  //         this.logger.error('Failed to update post', { postId, error: apiError.message });
  //         throw apiError;
  //       }
  //     },
  //     'updatePost',
  //     this.logger
  //   );
  // }

  /**
   * Delete a post
   */
  async deletePost(postId: string): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          await this.client.deletePost(postId);
          this.logger.info('Deleted post', { postId });
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to delete post ${postId}`);
          this.logger.error('Failed to delete post', { postId, error: apiError.message });
          throw apiError;
        }
      },
      'deletePost',
      this.logger
    );
  }

  /**
   * Get a specific post by ID
   */
  async getPost(postId: string): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const post = await this.client.getPost(postId);
          this.logger.info('Retrieved post', { 
            postId, 
            channelId: post.channel_id,
            messageLength: post.message?.length || 0
          });
          return post;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to get post ${postId}`);
          this.logger.error('Failed to get post', { postId, error: apiError.message });
          throw apiError;
        }
      },
      'getPost',
      this.logger
    );
  }

  /**
   * Get posts for a channel
   */
  async getPostsForChannel(channelId: string, options?: {
    page?: number;
    perPage?: number;
    since?: number;
    before?: string;
    after?: string;
  }): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const queryParams = {
            page: options?.page || 0,
            per_page: options?.perPage || 60,
            since: options?.since,
            before: options?.before,
            after: options?.after
          };

          const posts = await this.client.getPosts(channelId, queryParams.page, queryParams.per_page);
          this.logger.info('Retrieved channel posts', { 
            channelId, 
            postCount: posts.posts ? Object.keys(posts.posts).length : 0,
            page: queryParams.page,
            perPage: queryParams.per_page
          });
          return posts;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to get posts for channel ${channelId}`);
          this.logger.error('Failed to get channel posts', { channelId, error: apiError.message });
          throw apiError;
        }
      },
      'getPostsForChannel',
      this.logger
    );
  }

  /**
   * Get posts around a specific post (for context)
   * TEMPORARILY DISABLED - API method doesn't exist
   */
  // async getPostsAroundPost(postId: string, channelId: string, options?: {
  //   before?: number;
  //   after?: number;
  // }): Promise<any> {
  //   if (!this.isInitialized) {
  //     throw new Error('RestClient not initialized. Call initialize() first.');
  //   }

  //   return withRetry(
  //     async () => {
  //       try {
  //         const queryParams = {
  //           before: options?.before || 10,
  //           after: options?.after || 10
  //         };

  //         const posts = await this.client.getPostsAroundPost(postId, channelId, queryParams);
  //         this.logger.info('Retrieved posts around post', { 
  //           postId, 
  //           channelId,
  //           beforeCount: queryParams.before,
  //           afterCount: queryParams.after
  //         });
  //         return posts;
  //       } catch (error) {
  //         const apiError = this.createApiError(error, `Failed to get posts around post ${postId}`);
  //         this.logger.error('Failed to get posts around post', { postId, channelId, error: apiError.message });
  //         throw apiError;
  //       }
  //     },
  //     'getPostsAroundPost',
  //     this.logger
  //   );
  // }

  // ============================================================================
  // FILE OPERATIONS - TEMPORARILY DISABLED (API method issues)
  // ============================================================================

  // /**
  //  * Upload a file to Mattermost
  //  */
  // async uploadFile(channelId: string, filePath: string, filename?: string): Promise<any> {
  //   if (!this.isInitialized) {
  //     throw new Error('RestClient not initialized. Call initialize() first.');
  //   }

  //   return withRetry(
  //     async () => {
  //       try {
  //         const fileInfo = await this.client.uploadFile(channelId, filePath, filename);
  //         this.logger.info('Uploaded file', { 
  //           channelId, 
  //           filename: filename || filePath,
  //           fileId: fileInfo.id,
  //           size: fileInfo.size
  //         });
  //         return fileInfo;
  //       } catch (error) {
  //         const apiError = this.createApiError(error, `Failed to upload file '${filename || filePath}'`);
  //         this.logger.error('Failed to upload file', { channelId, filename, error: apiError.message });
  //         throw apiError;
  //       }
  //     },
  //     'uploadFile',
  //     this.logger,
  //     { maxRetries: 2, baseDelay: 2000 } // File uploads may need different retry settings
  //   );
  // }

  // /**
  //  * Get file information
  //  */
  // async getFileInfo(fileId: string): Promise<any> {
  //   if (!this.isInitialized) {
  //     throw new Error('RestClient not initialized. Call initialize() first.');
  //   }

  //   return withRetry(
  //     async () => {
  //       try {
  //         const fileInfo = await this.client.getFileInfo(fileId);
  //         this.logger.info('Retrieved file info', { 
  //           fileId, 
  //           filename: fileInfo.name,
  //           size: fileInfo.size,
  //           mimeType: fileInfo.mime_type
  //         });
  //         return fileInfo;
  //       } catch (error) {
  //         const apiError = this.createApiError(error, `Failed to get file info for ${fileId}`);
  //         this.logger.error('Failed to get file info', { fileId, error: apiError.message });
  //         throw apiError;
  //       }
  //     },
  //     'getFileInfo',
  //     this.logger
  //   );
  // }

  // /**
  //  * Download a file from Mattermost
  //  */
  // async downloadFile(fileId: string): Promise<Buffer> {
  //   if (!this.isInitialized) {
  //     throw new Error('RestClient not initialized. Call initialize() first.');
  //   }

  //   return withRetry(
  //     async () => {
  //       try {
  //         const fileData = await this.client.getFile(fileId);
  //         this.logger.info('Downloaded file', { fileId });
  //         return fileData;
  //       } catch (error) {
  //         const apiError = this.createApiError(error, `Failed to download file ${fileId}`);
  //         this.logger.error('Failed to download file', { fileId, error: apiError.message });
  //         throw apiError;
  //       }
  //     },
  //     'downloadFile',
  //     this.logger,
  //     { maxRetries: 2, baseDelay: 2000 } // File downloads may need different retry settings
  //   );
  // }

  // ============================================================================
  // USER OPERATIONS
  // ============================================================================

  /**
   * Get user profiles by IDs
   */
  async getUserProfiles(userIds: string[]): Promise<any[]> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const profiles = await this.client.getProfilesByIds(userIds);
          this.logger.info('Retrieved user profiles', { 
            userCount: userIds.length,
            retrievedCount: profiles.length
          });
          return profiles;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to get user profiles`);
          this.logger.error('Failed to get user profiles', { userIds, error: apiError.message });
          throw apiError;
        }
      },
      'getUserProfiles',
      this.logger
    );
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const user = await this.client.getUserByUsername(username);
          this.logger.info('Retrieved user by username', { 
            username, 
            userId: user.id,
            firstName: user.first_name,
            lastName: user.last_name
          });
          return user;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to get user '${username}'`);
          this.logger.error('Failed to get user by username', { username, error: apiError.message });
          throw apiError;
        }
      },
      'getUserByUsername',
      this.logger
    );
  }

  /**
   * Get user presence/status
   */
  async getUserStatus(userId: string): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }

    return withRetry(
      async () => {
        try {
          const status = await this.client.getStatus(userId);
          this.logger.info('Retrieved user status', { 
            userId, 
            status: status.status,
            manual: status.manual,
            lastActivityAt: status.last_activity_at
          });
          return status;
        } catch (error) {
          const apiError = this.createApiError(error, `Failed to get status for user ${userId}`);
          this.logger.error('Failed to get user status', { userId, error: apiError.message });
          throw apiError;
        }
      },
      'getUserStatus',
      this.logger
    );
  }


} 