import { IAgentRuntime, elizaLogger, ModelType, Memory, Content, State } from '@elizaos/core';
import { createSafeLogger } from '../config/credentials';
import { MattermostConfig } from '../config';
import { WebSocketClient } from '../clients/websocket.client';
import { RestClient } from '../clients/rest.client';

/**
 * Represents a Mattermost post from WebSocket events
 */
interface MattermostPost {
  id: string;
  user_id: string;
  channel_id: string;
  message: string;
  create_at: number;
  update_at: number;
  type: string;
  props: Record<string, any>;
  hashtags: string;
  pending_post_id: string;
  reply_count: number;
  last_reply_at: number;
  participants: any;
  is_following: boolean;
  channel_mentions: string[];
  root_id?: string;
  parent_id?: string;
}

/**
 * WebSocket event data structure for posted messages
 */
interface WebSocketPostedEvent {
  channel_display_name: string;
  channel_name: string;
  channel_type: string;
  post: string; // JSON stringified MattermostPost
  sender_name: string;
  team_id: string;
  mentions?: string; // JSON stringified array of user IDs
}

/**
 * Processed message information for routing decisions
 */
interface ProcessedMessage {
  post: MattermostPost;
  eventData: WebSocketPostedEvent;
  shouldProcess: boolean;
  reason: string;
  isDirectMessage: boolean;
  isMention: boolean;
  mentions: string[];
}

/**
 * Thread context for conversation history
 */
interface ThreadContext {
  threadId: string;
  messages: Array<{
    id: string;
    userId: string;
    message: string;
    timestamp: number;
    username?: string;
  }>;
  messageCount: number;
}

/**
 * AI response generation result
 */
interface AIResponseResult {
  success: boolean;
  response?: string;
  error?: string;
  model?: string;
  processingTime?: number;
}

/**
 * Message manager responsible for handling real-time messages from Mattermost
 * Integrates WebSocket events with ElizaOS message processing pipeline
 */
export class MessageManager {
  private config: MattermostConfig;
  private runtime: IAgentRuntime;
  private wsClient: WebSocketClient;
  private restClient: RestClient;
  private logger = createSafeLogger(elizaLogger);
  
  // State management
  private botUserId: string | null = null;
  private isInitialized = false;
  
  // Event handler references for cleanup
  private boundEventHandlers = new Map<string, (data: any) => void>();

  // Message processing cache
  private processedMessages = new Set<string>();
  private readonly MAX_CACHE_SIZE = 1000;

  constructor(
    config: MattermostConfig,
    runtime: IAgentRuntime,
    wsClient: WebSocketClient,
    restClient: RestClient
  ) {
    this.config = config;
    this.runtime = runtime;
    this.wsClient = wsClient;
    this.restClient = restClient;
  }

  /**
   * Initialize the message manager
   * Sets up WebSocket event listeners and retrieves bot user information
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('MessageManager already initialized');
      return;
    }

    try {
      this.logger.info('Initializing MessageManager...');

      // Ensure clients are ready
      if (!this.restClient.isReady()) {
        await this.restClient.initialize();
      }

      // Get bot user information
      await this.retrieveBotUserId();

      // Register WebSocket event handlers
      this.registerEventHandlers();

      this.isInitialized = true;
      this.logger.info('MessageManager initialized successfully', {
        botUserId: this.botUserId,
        registeredEvents: Array.from(this.boundEventHandlers.keys())
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to initialize MessageManager', error, { errorMessage });
      throw new Error(`MessageManager initialization failed: ${errorMessage}`);
    }
  }

  /**
   * Clean up the message manager
   * Removes event listeners and clears state
   */
  async cleanup(): Promise<void> {
    this.logger.info('Cleaning up MessageManager...');

    try {
      // Remove all WebSocket event listeners
      this.unregisterEventHandlers();

      // Clear caches
      this.processedMessages.clear();

      // Clear state
      this.botUserId = null;
      this.isInitialized = false;
      
      this.logger.info('MessageManager cleanup completed');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Error during MessageManager cleanup', error, { errorMessage });
    }
  }

  /**
   * Check if the message manager is ready to process messages
   */
  isReady(): boolean {
    return this.isInitialized && this.botUserId !== null;
  }

  /**
   * Get the current bot user ID
   */
  getBotUserId(): string | null {
    return this.botUserId;
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { processedCount: number; maxSize: number } {
    return {
      processedCount: this.processedMessages.size,
      maxSize: this.MAX_CACHE_SIZE
    };
  }

  /**
   * Retrieve bot user ID from the REST API
   * @private
   */
  private async retrieveBotUserId(): Promise<void> {
    try {
      const botUser = await this.restClient.getBotUser();
      this.botUserId = botUser.id;
      
      this.logger.info('Bot user information retrieved', {
        userId: botUser.id,
        username: botUser.username,
        email: botUser.email
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to retrieve bot user information', error, { errorMessage });
      throw new Error(`Failed to get bot user: ${errorMessage}`);
    }
  }

  /**
   * Register WebSocket event handlers for message processing
   * @private
   */
  private registerEventHandlers(): void {
    // Handler for new messages posted
    const postedHandler = this.handlePostedEvent.bind(this);
    this.boundEventHandlers.set('posted', postedHandler);
    this.wsClient.on('posted', postedHandler);

    // Handler for edited messages
    const editedHandler = this.handlePostEditedEvent.bind(this);
    this.boundEventHandlers.set('post_edited', editedHandler);
    this.wsClient.on('post_edited', editedHandler);

    // Handler for channel viewing (for context)
    const channelViewedHandler = this.handleChannelViewedEvent.bind(this);
    this.boundEventHandlers.set('channel_viewed', channelViewedHandler);
    this.wsClient.on('channel_viewed', channelViewedHandler);

    this.logger.info('WebSocket event handlers registered', {
      events: Array.from(this.boundEventHandlers.keys())
    });
  }

  /**
   * Remove all WebSocket event handlers
   * @private
   */
  private unregisterEventHandlers(): void {
    for (const [eventName, handler] of this.boundEventHandlers) {
      this.wsClient.off(eventName, handler);
      this.logger.debug(`Unregistered handler for event: ${eventName}`);
    }
    
    this.boundEventHandlers.clear();
    this.logger.info('All WebSocket event handlers unregistered');
  }

  /**
   * Manage processed message cache size
   * Removes oldest entries when cache exceeds maximum size
   * @private
   */
  private manageCacheSize(): void {
    if (this.processedMessages.size >= this.MAX_CACHE_SIZE) {
      // Convert to array, remove first half, convert back to Set
      const messages = Array.from(this.processedMessages);
      const keepCount = Math.floor(this.MAX_CACHE_SIZE / 2);
      const messagesToKeep = messages.slice(-keepCount);
      
      this.processedMessages.clear();
      messagesToKeep.forEach(id => this.processedMessages.add(id));
      
      this.logger.debug('Processed message cache trimmed', {
        previousSize: messages.length,
        newSize: this.processedMessages.size,
        maxSize: this.MAX_CACHE_SIZE
      });
    }
  }

  /**
   * Check if a message has already been processed
   * @private
   */
  private isMessageProcessed(messageId: string): boolean {
    return this.processedMessages.has(messageId);
  }

  /**
   * Mark a message as processed
   * @private
   */
  private markMessageProcessed(messageId: string): void {
    this.processedMessages.add(messageId);
    this.manageCacheSize();
  }

  /**
   * Retrieve thread context for conversation history
   * @private
   */
  private async getThreadContext(threadId: string, channelId: string): Promise<ThreadContext | null> {
    try {
      this.logger.debug('Retrieving thread context', { threadId, channelId });

      // Get posts around the thread root
      const threadPosts = await this.restClient.getPostsAroundPost(threadId, channelId, {
        before: 10,
        after: 10
      });

      if (!threadPosts?.posts) {
        this.logger.warn('No thread posts found', { threadId, channelId });
        return null;
      }

      // Convert posts to context format
      const messages = Object.values(threadPosts.posts)
        .filter((post: any) => post && post.message)
        .sort((a: any, b: any) => a.create_at - b.create_at)
        .map((post: any) => ({
          id: post.id,
          userId: post.user_id,
          message: post.message,
          timestamp: post.create_at,
          username: post.user_display_name || 'Unknown User'
        }))
        .slice(-10); // Keep last 10 messages for context

      const context: ThreadContext = {
        threadId,
        messages,
        messageCount: messages.length
      };

      this.logger.debug('Thread context retrieved', {
        threadId,
        messageCount: context.messageCount,
        contextSize: context.messages.length
      });

      return context;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn('Failed to retrieve thread context', { threadId, channelId, error: errorMessage });
      return null;
    }
  }

  /**
   * Generate AI response using ElizaOS runtime
   * @private
   */
  private async generateAIResponse(
    message: string, 
    context: ThreadContext | null,
    metadata: {
      userId: string;
      channelId: string;
      isDirectMessage: boolean;
      isMention: boolean;
    }
  ): Promise<AIResponseResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Generating AI response', {
        messageLength: message.length,
        hasContext: !!context,
        contextMessages: context?.messageCount || 0,
        isDirectMessage: metadata.isDirectMessage,
        isMention: metadata.isMention
      });

      // Build context string for the AI
      let contextString = '';
      if (context && context.messages.length > 0) {
        contextString = context.messages
          .map(msg => `${msg.username || 'User'}: ${msg.message}`)
          .join('\n');
        contextString = `Previous conversation:\n${contextString}\n\nCurrent message: ${message}`;
      } else {
        contextString = message;
      }

      // Generate response using ElizaOS runtime
      const aiResponse = await this.runtime.useModel(ModelType.TEXT_LARGE, {
        prompt: contextString,
        temperature: 0.7,
        maxTokens: 256,
        user: metadata.userId
      });
      
      // If the response is an object, extract the message
      let responseText: string;
      if (aiResponse && typeof aiResponse === 'object' && 'message' in aiResponse) {
        responseText = (aiResponse as any).message;
      } else if (typeof aiResponse === 'string' && aiResponse) {
        responseText = aiResponse;
      } else {
        responseText = 'I received your message, but I\'m having trouble generating a response right now. Please try again!';
      }

      const processingTime = Date.now() - startTime;

      this.logger.info('AI response generated successfully', {
        responseLength: responseText.length,
        processingTime,
        model: 'TEXT_LARGE'
      });

      return {
        success: true,
        response: responseText,
        model: 'TEXT_LARGE',
        processingTime
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Failed to generate AI response', error, {
        errorMessage,
        processingTime,
        messageLength: message.length
      });

      return {
        success: false,
        error: errorMessage,
        processingTime
      };
    }
  }

  /**
   * Post response back to Mattermost
   * @private
   */
  private async postResponse(
    channelId: string,
    response: string,
    rootId?: string
  ): Promise<void> {
    try {
      this.logger.info('Posting response to Mattermost', {
        channelId,
        responseLength: response.length,
        isThreadReply: !!rootId
      });

      await this.restClient.createPost(channelId, response, {
        rootId: rootId
      });

      this.logger.info('Response posted successfully', {
        channelId,
        rootId
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to post response', error, {
        errorMessage,
        channelId,
        rootId
      });
      throw error;
    }
  }

  /**
   * Determine if a message should be processed based on filtering rules
   * @private
   */
  private shouldProcessMessage(post: MattermostPost, eventData: WebSocketPostedEvent): ProcessedMessage {
    // Parse mentions if available
    let mentions: string[] = [];
    if (eventData.mentions) {
      try {
        mentions = JSON.parse(eventData.mentions);
      } catch (error) {
        this.logger.warn('Failed to parse mentions', { mentions: eventData.mentions });
      }
    }

    // Check if this is a direct message (channel type 'D')
    const isDirectMessage = eventData.channel_type === 'D';
    
    // Check if bot is mentioned
    const isMention = this.botUserId ? mentions.includes(this.botUserId) : false;

    // Filter 1: Skip bot's own messages
    if (post.user_id === this.botUserId) {
      return {
        post,
        eventData,
        shouldProcess: false,
        reason: 'Bot\'s own message - skipping to prevent loops',
        isDirectMessage,
        isMention,
        mentions
      };
    }

    // Filter 2: Skip already processed messages
    if (this.isMessageProcessed(post.id)) {
      return {
        post,
        eventData,
        shouldProcess: false,
        reason: 'Message already processed - duplicate prevention',
        isDirectMessage,
        isMention,
        mentions
      };
    }

    // Filter 3: Skip system messages (empty message or system type)
    if (!post.message.trim() || post.type !== '') {
      return {
        post,
        eventData,
        shouldProcess: false,
        reason: `System message or empty content - type: ${post.type}`,
        isDirectMessage,
        isMention,
        mentions
      };
    }

    // Process if it's a direct message
    if (isDirectMessage) {
      return {
        post,
        eventData,
        shouldProcess: true,
        reason: 'Direct message - always process',
        isDirectMessage,
        isMention,
        mentions
      };
    }

    // Process if bot is mentioned
    if (isMention) {
      return {
        post,
        eventData,
        shouldProcess: true,
        reason: 'Bot mentioned - process mention',
        isDirectMessage,
        isMention,
        mentions
      };
    }

    // Skip all other messages (public channels without mentions)
    return {
      post,
      eventData,
      shouldProcess: false,
      reason: 'Public channel without mention - skipping',
      isDirectMessage,
      isMention,
      mentions
    };
  }

  /**
   * Route a processed message to the appropriate handler and generate AI response
   * @private
   */
  private async routeMessage(processedMessage: ProcessedMessage): Promise<void> {
    const { post, eventData, isDirectMessage, isMention } = processedMessage;

    try {
      this.logger.info('Processing message for AI response', {
        postId: post.id,
        channelId: post.channel_id,
        channelName: eventData.channel_name,
        isDirectMessage,
        isMention,
        messagePreview: post.message.substring(0, 100)
      });

      // Mark as processed first to prevent duplicate handling
      this.markMessageProcessed(post.id);

      // Get thread context if this is a reply or we want conversation history
      const threadId = post.root_id || post.id;
      let threadContext: ThreadContext | null = null;
      
      if (post.root_id) {
        // This is a thread reply, get context
        threadContext = await this.getThreadContext(threadId, post.channel_id);
      }

      // Generate AI response
      const aiResult = await this.generateAIResponse(
        post.message,
        threadContext,
        {
          userId: post.user_id,
          channelId: post.channel_id,
          isDirectMessage,
          isMention
        }
      );

      if (aiResult.success && aiResult.response) {
        // Post the AI response back to Mattermost
        await this.postResponse(
          post.channel_id,
          aiResult.response,
          threadId // Reply in thread
        );

        this.logger.info('Message processed successfully', {
          postId: post.id,
          responseLength: aiResult.response.length,
          processingTime: aiResult.processingTime,
          cacheSize: this.processedMessages.size
        });

      } else {
        // AI generation failed, send fallback message
        const fallbackMessage = "I'm having trouble processing your message right now. Please try again in a moment! 🤖";
        
        await this.postResponse(
          post.channel_id,
          fallbackMessage,
          threadId
        );

        this.logger.warn('Used fallback response due to AI failure', {
          postId: post.id,
          error: aiResult.error
        });
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Error processing message', error, { 
        errorMessage,
        postId: post.id,
        channelId: post.channel_id
      });

      // Try to send an error message to the user
      try {
        const errorResponse = "Sorry, I encountered an error while processing your message. Please try again later! 🔧";
        await this.postResponse(
          post.channel_id,
          errorResponse,
          post.root_id || post.id
        );
      } catch (sendError) {
        this.logger.error('Failed to send error response', sendError);
      }
    }
  }

  /**
   * Handle 'posted' WebSocket events (new messages)
   * @private
   */
  private async handlePostedEvent(data: WebSocketPostedEvent): Promise<void> {
    try {
      this.logger.debug('Received posted event', {
        channelName: data.channel_name,
        channelType: data.channel_type,
        senderName: data.sender_name
      });

      // Parse the post data
      const post: MattermostPost = JSON.parse(data.post);
      
      // Apply filtering logic
      const processedMessage = this.shouldProcessMessage(post, data);
      
      this.logger.debug('Message filtering result', {
        postId: post.id,
        shouldProcess: processedMessage.shouldProcess,
        reason: processedMessage.reason,
        isDirectMessage: processedMessage.isDirectMessage,
        isMention: processedMessage.isMention,
        mentionCount: processedMessage.mentions.length
      });

      // Route message if it should be processed
      if (processedMessage.shouldProcess) {
        await this.routeMessage(processedMessage);
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Error handling posted event', error, { 
        errorMessage,
        eventData: data 
      });
    }
  }

  /**
   * Handle 'post_edited' WebSocket events (edited messages)
   * @private
   */
  private async handlePostEditedEvent(data: any): Promise<void> {
    try {
      this.logger.debug('Received post_edited event', {
        eventData: data
      });

      // TODO: Add edited message handling logic in future iterations
      // For now, we'll skip processing edited messages to avoid complexity

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Error handling post_edited event', error, { 
        errorMessage,
        eventData: data 
      });
    }
  }

  /**
   * Handle 'channel_viewed' WebSocket events (for context awareness)
   * @private
   */
  private async handleChannelViewedEvent(data: any): Promise<void> {
    try {
      this.logger.debug('Received channel_viewed event', {
        eventData: data
      });

      // TODO: Add channel context handling logic in future subtasks

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Error handling channel_viewed event', error, { 
        errorMessage,
        eventData: data 
      });
    }
  }
} 