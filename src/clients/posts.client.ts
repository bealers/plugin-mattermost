import { Client4 } from 'mattermost-redux/client';
import { MattermostConfig } from '../config';
import { BaseClient } from './core/base-client';

/**
 * Interface for post creation options
 */
export interface CreatePostOptions {
  fileIds?: string[];
  props?: any;
  rootId?: string;
}

/**
 * Interface for getting posts options
 */
export interface GetPostsOptions {
  page?: number;
  perPage?: number;
  since?: number;
  before?: string;
  after?: string;
}

/**
 * Dedicated client for managing post operations
 */
export class PostsClient extends BaseClient {
  constructor(client: InstanceType<typeof Client4>, config: MattermostConfig, logger: any) {
    super(client, config, logger);
  }

  /**
   * Create a new post in a channel
   * @param channelId The channel to post in
   * @param message The message content
   * @param options Additional post options
   */
  async createPost(
    channelId: string,
    message: string,
    options: CreatePostOptions = {}
  ): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        const postData = {
          channel_id: channelId,
          message: message,
          file_ids: options.fileIds || [],
          props: options.props || {},
          ...(options.rootId && { root_id: options.rootId })
        };

        this.logger.debug('Creating post', { 
          channelId, 
          messageLength: message.length,
          hasAttachments: !!options.fileIds?.length,
          isReply: !!options.rootId
        });

        const post = await this.client.createPost(postData);
        
        this.logger.info('Post created successfully', { 
          postId: post.id,
          channelId,
          isReply: !!options.rootId
        });

        return post;

      } catch (error) {
        this.logger.error('Failed to create post', { 
          channelId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to create post');
      }
    }, `createPost(${channelId})`);
  }

  /**
   * Get a specific post by ID
   * @param postId The post ID to retrieve
   */
  async getPost(postId: string): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving post', { postId });

        const post = await this.client.getPost(postId);
        
        if (!post) {
          throw new Error(`Post not found: ${postId}`);
        }

        this.logger.debug('Post retrieved successfully', { 
          postId,
          channelId: post.channel_id,
          userId: post.user_id
        });

        return post;

      } catch (error) {
        this.logger.error('Failed to get post', { 
          postId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to get post');
      }
    }, `getPost(${postId})`);
  }

  /**
   * Get posts for a specific channel
   * @param channelId The channel ID
   * @param options Options for pagination and filtering
   */
  async getPostsForChannel(
    channelId: string,
    options: GetPostsOptions = {}
  ): Promise<any> {
    const {
      page = 0,
      perPage = 60,
      since,
      before,
      after
    } = options;

    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving posts for channel', { 
          channelId, 
          page, 
          perPage,
          since,
          before,
          after
        });

        let posts;
        if (since) {
          posts = await this.client.getPostsSince(channelId, since);
        } else if (before || after) {
          posts = await this.client.getPostsAfter(channelId, after || '', perPage);
        } else {
          posts = await this.client.getPostsForChannel(channelId, page, perPage);
        }
        
        if (!posts) {
          this.logger.warn('No posts found for channel', { channelId });
          return { posts: {}, order: [] };
        }

        this.logger.debug('Channel posts retrieved successfully', { 
          channelId,
          postCount: posts.order ? posts.order.length : Object.keys(posts.posts || {}).length
        });

        return posts;

      } catch (error) {
        this.logger.error('Failed to get posts for channel', { 
          channelId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to get posts for channel');
      }
    }, `getPostsForChannel(${channelId})`);
  }

  /**
   * Update an existing post
   * @param postId The post ID to update
   * @param message The new message content
   * @param options Additional update options
   */
  async updatePost(
    postId: string,
    message: string,
    options: { props?: any } = {}
  ): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        const updateData = {
          id: postId,
          message: message,
          props: options.props || {}
        };

        this.logger.debug('Updating post', { 
          postId, 
          messageLength: message.length
        });

        const updatedPost = await this.client.patchPost(updateData);
        
        this.logger.info('Post updated successfully', { 
          postId,
          channelId: updatedPost.channel_id
        });

        return updatedPost;

      } catch (error) {
        this.logger.error('Failed to update post', { 
          postId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to update post');
      }
    }, `updatePost(${postId})`);
  }

  /**
   * Delete a post
   * @param postId The post ID to delete
   */
  async deletePost(postId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Deleting post', { postId });

        await this.client.deletePost(postId);
        
        this.logger.info('Post deleted successfully', { postId });

      } catch (error) {
        this.logger.error('Failed to delete post', { 
          postId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to delete post');
      }
    }, `deletePost(${postId})`);
  }

  /**
   * Get posts since a specific timestamp
   * @param channelId The channel ID
   * @param since Timestamp in milliseconds
   */
  async getPostsSince(channelId: string, since: number): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving posts since timestamp', { 
          channelId, 
          since,
          sinceDate: new Date(since).toISOString()
        });

        const posts = await this.client.getPostsSince(channelId, since);
        
        this.logger.debug('Posts since timestamp retrieved successfully', { 
          channelId,
          postCount: posts.order ? posts.order.length : 0
        });

        return posts;

      } catch (error) {
        this.logger.error('Failed to get posts since timestamp', { 
          channelId, 
          since,
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to get posts since timestamp');
      }
    }, `getPostsSince(${channelId}, ${since})`);
  }

  /**
   * Get posts before a specific post
   * @param channelId The channel ID
   * @param postId The post ID to get posts before
   * @param perPage Number of posts per page
   */
  async getPostsBefore(
    channelId: string,
    postId: string,
    perPage: number = 60
  ): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving posts before post', { 
          channelId, 
          postId,
          perPage
        });

        const posts = await this.client.getPostsBefore(channelId, postId, perPage);
        
        this.logger.debug('Posts before post retrieved successfully', { 
          channelId,
          postId,
          postCount: posts.order ? posts.order.length : 0
        });

        return posts;

      } catch (error) {
        this.logger.error('Failed to get posts before post', { 
          channelId, 
          postId,
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to get posts before post');
      }
    }, `getPostsBefore(${channelId}, ${postId})`);
  }

  /**
   * Get posts after a specific post
   * @param channelId The channel ID
   * @param postId The post ID to get posts after
   * @param perPage Number of posts per page
   */
  async getPostsAfter(
    channelId: string,
    postId: string,
    perPage: number = 60
  ): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Retrieving posts after post', { 
          channelId, 
          postId,
          perPage
        });

        const posts = await this.client.getPostsAfter(channelId, postId, perPage);
        
        this.logger.debug('Posts after post retrieved successfully', { 
          channelId,
          postId,
          postCount: posts.order ? posts.order.length : 0
        });

        return posts;

      } catch (error) {
        this.logger.error('Failed to get posts after post', { 
          channelId, 
          postId,
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to get posts after post');
      }
    }, `getPostsAfter(${channelId}, ${postId})`);
  }

  /**
   * Pin a post to a channel
   * @param postId The post ID to pin
   */
  async pinPost(postId: string): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Pinning post', { postId });

        const result = await this.client.pinPost(postId);
        
        this.logger.info('Post pinned successfully', { postId });

        return result;

      } catch (error) {
        this.logger.error('Failed to pin post', { 
          postId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to pin post');
      }
    }, `pinPost(${postId})`);
  }

  /**
   * Unpin a post from a channel
   * @param postId The post ID to unpin
   */
  async unpinPost(postId: string): Promise<any> {
    return this.executeWithRetry(async () => {
      try {
        this.logger.debug('Unpinning post', { postId });

        const result = await this.client.unpinPost(postId);
        
        this.logger.info('Post unpinned successfully', { postId });

        return result;

      } catch (error) {
        this.logger.error('Failed to unpin post', { 
          postId, 
          error: error instanceof Error ? error.message : String(error) 
        });
        throw this.createApiError(error, 'Failed to unpin post');
      }
    }, `unpinPost(${postId})`);
  }
} 