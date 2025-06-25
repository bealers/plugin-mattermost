import { Client4 } from 'mattermost-redux/client';
import { elizaLogger, createSafeLogger } from '@elizaos/core';
import { MattermostConfig } from '../config';
import { ThreadsClient, ThreadContext, ThreadContextOptions } from './threads.client';
import { PostsClient, CreatePostOptions, GetPostsOptions } from './posts.client';
import { BaseClient, withRetry, MattermostApiError } from './core/base-client';
import { RateLimiter } from './core/rate-limiter';

// Re-export types for convenience
export { ThreadContext, ThreadContextOptions, CreatePostOptions, GetPostsOptions, MattermostApiError };

/**
 * Main REST client that orchestrates all Mattermost API operations
 * Now using a modular architecture with specialized clients
 */
export class RestClient extends BaseClient {
  private isInitialized = false;
  private botUser: any = null;
  private retryCount = 0;
  private readonly maxInitRetries = 5;
  private readonly initRetryDelay = 2000;

  // Specialized clients
  public readonly threads: ThreadsClient;
  public readonly posts: PostsClient;

  constructor(config: MattermostConfig) {
    const logger = createSafeLogger('RestClient', elizaLogger);
    const client = new Client4();
    
    super(client, config, logger);
    
    // Initialize specialized clients
    this.threads = new ThreadsClient(client, config, logger);
    this.posts = new PostsClient(client, config, logger);
  }

  /**
   * Initialize the REST client with authentication and connection
   */
  async initialize(): Promise<void> {
    return this.executeWithRetry(async () => {
      if (this.isInitialized) {
        this.logger.debug('RestClient already initialized');
        return;
      }

      try {
        this.logger.info('Initializing RestClient', {
          serverUrl: this.config.serverUrl,
          botUsername: this.config.botUsername,
          attempt: this.retryCount + 1
        });

        // Configure client
        this.client.setUrl(this.config.serverUrl);
        
        // Authenticate
        await this.authenticate();
        
        // Get bot user info
        this.botUser = await this.client.getMe();
        
        this.isInitialized = true;
        this.retryCount = 0;
        
        this.logger.info('RestClient initialized successfully', {
          botUserId: this.botUser.id,
          botUsername: this.botUser.username
        });

      } catch (error) {
        this.retryCount++;
        
        if (this.retryCount >= this.maxInitRetries) {
          this.logger.error('RestClient initialization failed after max retries', {
            retryCount: this.retryCount,
            error: error instanceof Error ? error.message : String(error)
          });
          throw this.createApiError(error, 'Failed to initialize RestClient after maximum retries');
        }

        this.logger.warn('RestClient initialization attempt failed, will retry', {
          attempt: this.retryCount,
          maxRetries: this.maxInitRetries,
          nextRetryIn: this.initRetryDelay,
          error: error instanceof Error ? error.message : String(error)
        });

        await new Promise(resolve => setTimeout(resolve, this.initRetryDelay));
        throw error; // This will trigger the retry mechanism
      }
    }, 'initialize', {
      maxRetries: this.maxInitRetries,
      baseDelay: this.initRetryDelay
    });
  }

  /**
   * Authenticate with the Mattermost server
   * @private
   */
  private async authenticate(): Promise<void> {
    try {
      if (this.config.accessToken) {
        this.logger.debug('Authenticating with access token');
        this.client.setToken(this.config.accessToken);
      } else if (this.config.botUsername && this.config.botPassword) {
        this.logger.debug('Authenticating with username/password', {
          username: this.config.botUsername
        });
        await this.client.loginById(this.config.botUsername, this.config.botPassword);
      } else {
        throw new Error('No authentication method provided (accessToken or botUsername/botPassword)');
      }

      // Test authentication by making a simple API call
      await this.client.getMe();
      
    } catch (error) {
      this.logger.error('Authentication failed', {
        hasToken: !!this.config.accessToken,
        hasCredentials: !!(this.config.botUsername && this.config.botPassword),
        error: error instanceof Error ? error.message : String(error)
      });
      throw this.createApiError(error, 'Authentication failed');
    }
  }

  /**
   * Check if the client is ready for use
   */
  get isReady(): boolean {
    return this.isInitialized && !!this.botUser;
  }

  /**
   * Get the bot user information
   */
  getBotUser(): any {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }
    return this.botUser;
  }

  // ============================================================
  // DELEGATION METHODS (these now delegate to specialized clients)
  // ============================================================

  /**
   * Get thread context - delegates to ThreadsClient
   */
  async getThreadContext(
    threadId: string, 
    channelId: string, 
    options?: ThreadContextOptions
  ): Promise<ThreadContext> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }
    return this.threads.getThreadContext(threadId, channelId, options);
  }

  /**
   * Reply to a thread - delegates to ThreadsClient
   */
  async replyToThread(
    channelId: string,
    threadId: string,
    message: string,
    options?: { fileIds?: string[]; props?: any }
  ): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }
    return this.threads.replyToThread(channelId, threadId, message, options);
  }

  /**
   * Create a post - delegates to PostsClient
   */
  async createPost(
    channelId: string,
    message: string,
    options?: CreatePostOptions
  ): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }
    return this.posts.createPost(channelId, message, options);
  }

  /**
   * Get a post by ID - delegates to PostsClient
   */
  async getPost(postId: string): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }
    return this.posts.getPost(postId);
  }

  /**
   * Get posts for channel - delegates to PostsClient
   */
  async getPostsForChannel(
    channelId: string,
    options?: GetPostsOptions
  ): Promise<any> {
    if (!this.isInitialized) {
      throw new Error('RestClient not initialized. Call initialize() first.');
    }
    return this.posts.getPostsForChannel(channelId, options);
  }

  // ============================================================
  // REMAINING METHODS (User, Channel, File operations)
  // ============================================================

  /**
   * Get user information by ID
   */
  async getUser(userId: string): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving user', { userId });
        const user = await this.client.getUser(userId);
        this.logger.debug('User retrieved successfully', { 
          userId, 
          username: user.username 
        });
        return user;
      } catch (error) {
        throw this.createApiError(error, 'Failed to get user');
      }
    }, `getUser(${userId})`);
  }

  /**
   * Get channel information by ID
   */
  async getChannel(channelId: string): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving channel', { channelId });
        const channel = await this.client.getChannel(channelId);
        this.logger.debug('Channel retrieved successfully', { 
          channelId, 
          channelName: channel.name,
          channelType: channel.type
        });
        return channel;
      } catch (error) {
        throw this.createApiError(error, 'Failed to get channel');
      }
    }, `getChannel(${channelId})`);
  }

  /**
   * Get channels for a team
   */
  async getChannels(teamId: string, page?: number, perPage?: number): Promise<any[]> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving channels for team', { 
          teamId, 
          page: page || 0, 
          perPage: perPage || 200 
        });
        
        const channels = await this.client.getChannels(teamId, page, perPage);
        
        this.logger.debug('Team channels retrieved successfully', { 
          teamId, 
          channelCount: channels.length 
        });
        
        return channels;
      } catch (error) {
        throw this.createApiError(error, 'Failed to get team channels');
      }
    }, `getChannels(${teamId})`);
  }

  /**
   * Get teams for the authenticated user
   */
  async getTeams(): Promise<any[]> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving teams for user');
        const teams = await this.client.getMyTeams();
        this.logger.debug('User teams retrieved successfully', { 
          teamCount: teams.length 
        });
        return teams;
      } catch (error) {
        throw this.createApiError(error, 'Failed to get user teams');
      }
    }, 'getTeams');
  }

  /**
   * Upload a file to Mattermost
   */
  async uploadFile(
    channelId: string,
    file: File | Buffer,
    filename: string
  ): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Uploading file', { 
          channelId, 
          filename,
          fileSize: file instanceof File ? file.size : file.length
        });
        
        const formData = new FormData();
        formData.append('files', file, filename);
        formData.append('channel_id', channelId);
        
        const fileInfos = await this.client.uploadFile(
          formData,
          'files',
          filename
        );
        
        this.logger.info('File uploaded successfully', { 
          channelId, 
          filename,
          fileId: fileInfos.file_infos[0].id
        });
        
        return fileInfos;
      } catch (error) {
        throw this.createApiError(error, 'Failed to upload file');
      }
    }, `uploadFile(${filename})`);
  }

  /**
   * Get file information
   */
  async getFileInfo(fileId: string): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving file info', { fileId });
        const fileInfo = await this.client.getFileInfo(fileId);
        this.logger.debug('File info retrieved successfully', { 
          fileId, 
          filename: fileInfo.name 
        });
        return fileInfo;
      } catch (error) {
        throw this.createApiError(error, 'Failed to get file info');
      }
    }, `getFileInfo(${fileId})`);
  }

  /**
   * Get channel members
   */
  async getChannelMembers(channelId: string, page?: number, perPage?: number): Promise<any[]> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving channel members', { 
          channelId, 
          page: page || 0, 
          perPage: perPage || 200 
        });
        
        const members = await this.client.getChannelMembers(channelId, page, perPage);
        
        this.logger.debug('Channel members retrieved successfully', { 
          channelId, 
          memberCount: members.length 
        });
        
        return members;
      } catch (error) {
        throw this.createApiError(error, 'Failed to get channel members');
      }
    }, `getChannelMembers(${channelId})`);
  }
} 