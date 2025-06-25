import { Client4 } from 'mattermost-redux/client';
import { MattermostConfig } from '../config';
import { BaseClient } from './core/base-client';

/**
 * Interface for thread context options
 */
export interface ThreadContextOptions {
  maxMessages?: number;
  includeFuture?: boolean;
  beforeCount?: number;
  afterCount?: number;
}

/**
 * Interface for thread context data
 */
export interface ThreadContext {
  posts: any[];
  messageCount: number;
  participantCount: number;
  lastActivity: Date;
  rootPost?: any;
  isActive: boolean;
}

/**
 * Dedicated client for managing thread operations in Mattermost
 * Extracted from RestClient for better modularity and maintainability
 */
export class ThreadsClient extends BaseClient {
  constructor(client: InstanceType<typeof Client4>, config: MattermostConfig, logger: any) {
    super(client, config, logger);
  }

  /**
   * Get comprehensive thread context for conversation history
   * @param threadId The root post ID of the thread
   * @param channelId The channel containing the thread
   * @param options Configuration options for context retrieval
   */
  async getThreadContext(
    threadId: string, 
    channelId: string, 
    options: ThreadContextOptions = {}
  ): Promise<ThreadContext> {
    const {
      maxMessages = 15,
      includeFuture = false,
      beforeCount = 10,
      afterCount = 5
    } = options;

    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving comprehensive thread context', { 
          threadId, 
          channelId, 
          maxMessages,
          includeFuture
        });

        // Get the root post first
        const rootPost = await this.client.getPost(threadId);
        if (!rootPost) {
          throw new Error(`Root post not found: ${threadId}`);
        }

        // Get thread posts using the posts for channel method with filtering
        const channelPosts = await this.client.getPostsForChannel(channelId, 0, maxMessages * 2);
        
        if (!channelPosts || !channelPosts.posts) {
          this.logger.warn('No posts found in channel for thread context', { channelId, threadId });
          return this.createEmptyThreadContext(rootPost);
        }

        // Filter posts that belong to this thread
        const threadPosts = Object.values(channelPosts.posts)
          .filter((post: any) => {
            // Include the root post and all replies to it
            return post.id === threadId || post.root_id === threadId;
          })
          .sort((a: any, b: any) => a.create_at - b.create_at);

        // Limit to requested number of messages
        const limitedPosts = includeFuture ? 
          threadPosts.slice(-maxMessages) : 
          threadPosts.slice(0, maxMessages);

        // Calculate thread statistics
        const participants = new Set(limitedPosts.map((post: any) => post.user_id));
        const lastActivity = limitedPosts.length > 0 ? 
          new Date(limitedPosts[limitedPosts.length - 1].create_at) : 
          new Date(rootPost.create_at);

        const threadContext: ThreadContext = {
          posts: limitedPosts,
          messageCount: limitedPosts.length,
          participantCount: participants.size,
          lastActivity,
          rootPost,
          isActive: this.isThreadActive(lastActivity)
        };

        this.logger.debug('Thread context retrieved successfully', {
          threadId,
          messageCount: threadContext.messageCount,
          participantCount: threadContext.participantCount,
          isActive: threadContext.isActive
        });

        return threadContext;

      } catch (error) {
        this.logger.error('Failed to retrieve thread context', { 
          threadId, 
          channelId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to get thread context');
      }
    }, `getThreadContext(${threadId})`);
  }

  /**
   * Get thread posts using alternative method for better reliability
   * @param threadId The root post ID
   * @param channelId The channel ID
   * @param options Retrieval options
   */
  async getThreadPosts(
    threadId: string,
    channelId: string,
    options: ThreadContextOptions = {}
  ): Promise<any[]> {
    const { maxMessages = 20 } = options;

    return this.executeWithRetry(async () => {
      try {
        // Try to get posts directly from the thread first
        let threadPosts: any[] = [];

        try {
          // Some Mattermost instances have getPostThread method
          if (typeof this.client.getPostThread === 'function') {
            const threadData = await this.client.getPostThread(threadId);
            threadPosts = threadData ? Object.values(threadData.posts || {}) : [];
          }
        } catch (error) {
          this.logger.debug('getPostThread not available, using alternative method', { threadId });
        }

        // Fallback: Get posts from channel and filter
        if (threadPosts.length === 0) {
          const channelPosts = await this.client.getPostsForChannel(channelId, 0, maxMessages * 2);
          threadPosts = Object.values(channelPosts.posts || {})
            .filter((post: any) => post.id === threadId || post.root_id === threadId)
            .sort((a: any, b: any) => a.create_at - b.create_at);
        }

        return threadPosts.slice(0, maxMessages);

      } catch (error) {
        this.logger.error('Failed to get thread posts', { threadId, channelId, error });
        throw this.createApiError(error, 'Failed to get thread posts');
      }
    }, `getThreadPosts(${threadId})`);
  }

  /**
   * Post a reply to a thread
   * @param channelId The channel ID
   * @param threadId The root post ID to reply to
   * @param message The reply message
   * @param options Additional posting options
   */
  async replyToThread(
    channelId: string,
    threadId: string,
    message: string,
    options: { fileIds?: string[]; props?: any } = {}
  ): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        const postData = {
          channel_id: channelId,
          message: message,
          root_id: threadId, // This makes it a thread reply
          file_ids: options.fileIds || [],
          props: options.props || {}
        };

        this.logger.debug('Posting thread reply', { 
          channelId, 
          threadId, 
          messageLength: message.length,
          hasAttachments: !!options.fileIds?.length
        });

        const post = await this.client.createPost(postData);
        
        this.logger.info('Thread reply posted successfully', { 
          postId: post.id,
          threadId,
          channelId
        });

        return post;

      } catch (error) {
        this.logger.error('Failed to post thread reply', { 
          channelId, 
          threadId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to post thread reply');
      }
    }, `replyToThread(${threadId})`);
  }

  /**
   * Check if a thread is considered active based on last activity
   * @private
   */
  private isThreadActive(lastActivity: Date): boolean {
    const now = new Date();
    const timeDiff = now.getTime() - lastActivity.getTime();
    const hoursOld = timeDiff / (1000 * 60 * 60);
    
    // Consider a thread active if it had activity in the last 24 hours
    return hoursOld < 24;
  }

  /**
   * Create an empty thread context when no posts are found
   * @private
   */
  private createEmptyThreadContext(rootPost: any): ThreadContext {
    return {
      posts: [rootPost],
      messageCount: 1,
      participantCount: 1,
      lastActivity: new Date(rootPost.create_at),
      rootPost,
      isActive: this.isThreadActive(new Date(rootPost.create_at))
    };
  }

  /**
   * Get thread statistics without full context
   * @param threadId The root post ID
   * @param channelId The channel ID
   */
  async getThreadStats(threadId: string, channelId: string): Promise<{
    messageCount: number;
    participantCount: number;
    lastActivity: Date;
    isActive: boolean;
  }> {
    return this.executeWithRetry(async () => {
      try {
        const posts = await this.getThreadPosts(threadId, channelId, { maxMessages: 50 });
        const participants = new Set(posts.map(post => post.user_id));
        const lastActivity = posts.length > 0 ? 
          new Date(posts[posts.length - 1].create_at) : 
          new Date();

        return {
          messageCount: posts.length,
          participantCount: participants.size,
          lastActivity,
          isActive: this.isThreadActive(lastActivity)
        };

      } catch (error) {
        this.logger.error('Failed to get thread stats', { threadId, channelId, error });
        throw this.createApiError(error, 'Failed to get thread stats');
      }
    }, `getThreadStats(${threadId})`);
  }
} 