import { IAgentRuntime, elizaLogger, ModelType, Memory, Content, State, createUniqueUuid, ChannelType, HandlerCallback } from '@elizaos/core';
import { createSafeLogger } from '../config/credentials';
import { MattermostConfig } from '../config';
import { WebSocketClient } from '../clients/websocket.client';
import { RestClient, ThreadContext } from '../clients/rest.client';
import { AttachmentManager } from './attachment.manager';
import { v4 as uuidv4 } from 'uuid';

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
  file_ids?: string[]; // File attachments
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

// ThreadContext is now imported from RestClient

/**
 * AI response generation result
 */
interface AIResponseResult {
  success: boolean;
  response?: string;
  error?: string;
  model?: string;
  processingTime?: number;
  errorType?: ErrorType;
  retryable?: boolean;
}

/**
 * Error types for categorization and handling
 */
enum ErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  API_RATE_LIMIT = 'API_RATE_LIMIT',
  AI_MODEL_ERROR = 'AI_MODEL_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Circuit breaker state for service resilience
 */
interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  successCount: number;
}

/**
 * Error handling configuration
 */
interface ErrorHandlingConfig {
  maxRetries: number;
  retryDelay: number;
  circuitBreakerThreshold: number;
  circuitBreakerTimeout: number;
  enableFallbackMessages: boolean;
}

/**
 * Health monitoring metrics
 */
interface HealthMetrics {
  totalMessages: number;
  successfulResponses: number;
  failedResponses: number;
  averageResponseTime: number;
  lastHealthCheck: number;
  errorsByType: Record<ErrorType, number>;
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
  private attachmentManager: AttachmentManager;
  private logger = createSafeLogger(elizaLogger);
  
  // State management
  private botUserId: string | null = null;
  private isInitialized = false;
  
  // Event handler references for cleanup
  private boundEventHandlers = new Map<string, (data: any) => void>();

  // Message processing cache
  private processedMessages = new Set<string>();
  private readonly MAX_CACHE_SIZE = 1000;

  // Error handling and resilience
  private errorConfig: ErrorHandlingConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    circuitBreakerThreshold: 5,
    circuitBreakerTimeout: 60000, // 1 minute
    enableFallbackMessages: true
  };

  private circuitBreakers = new Map<string, CircuitBreakerState>();
  private healthMetrics: HealthMetrics = {
    totalMessages: 0,
    successfulResponses: 0,
    failedResponses: 0,
    averageResponseTime: 0,
    lastHealthCheck: Date.now(),
    errorsByType: Object.values(ErrorType).reduce((acc, type) => {
      acc[type] = 0;
      return acc;
    }, {} as Record<ErrorType, number>)
  };

  private responseTimes: number[] = [];
  private readonly MAX_RESPONSE_TIME_SAMPLES = 100;

  constructor(
    config: MattermostConfig,
    runtime: IAgentRuntime,
    wsClient: WebSocketClient,
    restClient: RestClient,
    attachmentManager: AttachmentManager
  ) {
    this.config = config;
    this.runtime = runtime;
    this.wsClient = wsClient;
    this.restClient = restClient;
    this.attachmentManager = attachmentManager;
    
    // Initialize circuit breakers
    this.initializeCircuitBreakers();
  }

  /**
   * Initialize circuit breakers for different services
   * @private
   */
  private initializeCircuitBreakers(): void {
    const services = ['ai-generation', 'thread-context', 'message-posting'];
    services.forEach(service => {
      this.circuitBreakers.set(service, {
        failures: 0,
        lastFailureTime: 0,
        state: 'CLOSED',
        successCount: 0
      });
    });
  }

  /**
   * Check if a circuit breaker allows operation
   * @private
   */
  private isCircuitBreakerOpen(service: string): boolean {
    const breaker = this.circuitBreakers.get(service);
    if (!breaker) return false;

    if (breaker.state === 'OPEN') {
      const timeSinceFailure = Date.now() - breaker.lastFailureTime;
      if (timeSinceFailure > this.errorConfig.circuitBreakerTimeout) {
        breaker.state = 'HALF_OPEN';
        breaker.successCount = 0;
        this.logger.info(`Circuit breaker for ${service} moved to HALF_OPEN`);
      }
      return breaker.state === 'OPEN';
    }

    return false;
  }

  /**
   * Record circuit breaker success
   * @private
   */
  private recordCircuitBreakerSuccess(service: string): void {
    const breaker = this.circuitBreakers.get(service);
    if (!breaker) return;

    if (breaker.state === 'HALF_OPEN') {
      breaker.successCount++;
      if (breaker.successCount >= 3) {
        breaker.state = 'CLOSED';
        breaker.failures = 0;
        this.logger.info(`Circuit breaker for ${service} CLOSED - service recovered`);
      }
    } else if (breaker.state === 'CLOSED') {
      breaker.failures = Math.max(0, breaker.failures - 1);
    }
  }

  /**
   * Record circuit breaker failure
   * @private
   */
  private recordCircuitBreakerFailure(service: string): void {
    const breaker = this.circuitBreakers.get(service);
    if (!breaker) return;

    breaker.failures++;
    breaker.lastFailureTime = Date.now();

    if (breaker.failures >= this.errorConfig.circuitBreakerThreshold) {
      breaker.state = 'OPEN';
      this.logger.warn(`Circuit breaker for ${service} OPENED - too many failures`, {
        failures: breaker.failures,
        threshold: this.errorConfig.circuitBreakerThreshold
      });
    }
  }

  /**
   * Categorize error for proper handling
   * @private
   */
  private categorizeError(error: any): ErrorType {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorCode = error?.code;

    if (errorMessage.includes('network') || errorMessage.includes('econnrefused') || errorCode === 'ENOTFOUND') {
      return ErrorType.NETWORK_ERROR;
    }
    if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests') || errorCode === 429) {
      return ErrorType.API_RATE_LIMIT;
    }
    if (errorMessage.includes('unauthorized') || errorMessage.includes('forbidden') || [401, 403].includes(errorCode)) {
      return ErrorType.AUTHENTICATION_ERROR;
    }
    if (errorMessage.includes('timeout') || errorCode === 'ETIMEDOUT') {
      return ErrorType.TIMEOUT_ERROR;
    }
    if (errorMessage.includes('validation') || errorMessage.includes('invalid') || errorCode === 400) {
      return ErrorType.VALIDATION_ERROR;
    }
    if (errorMessage.includes('model') || errorMessage.includes('ai') || errorMessage.includes('generation')) {
      return ErrorType.AI_MODEL_ERROR;
    }

    return ErrorType.UNKNOWN_ERROR;
  }

  /**
   * Get user-friendly error message based on error type
   * @private
   */
  private getUserFriendlyErrorMessage(errorType: ErrorType, isDirectMessage: boolean): string {
    const prefix = isDirectMessage ? "Sorry," : "Apologies,";
    
    switch (errorType) {
      case ErrorType.NETWORK_ERROR:
        return `${prefix} I'm having trouble connecting to my AI services right now. Please try again in a moment! 🔌`;
      
      case ErrorType.API_RATE_LIMIT:
        return `${prefix} I'm getting a lot of requests right now. Please wait a moment and try again! ⏱️`;
      
      case ErrorType.AI_MODEL_ERROR:
        return `${prefix} my AI brain is having a temporary hiccup. Give me a moment to recover! 🤖`;
      
      case ErrorType.AUTHENTICATION_ERROR:
        return `${prefix} I'm having authentication issues. My admin needs to check my credentials! 🔐`;
      
      case ErrorType.TIMEOUT_ERROR:
        return `${prefix} that took too long to process. Please try asking in a simpler way! ⏰`;
      
      case ErrorType.VALIDATION_ERROR:
        return `${prefix} I didn't understand your message format. Could you rephrase that? 🤔`;
      
      default:
        return `${prefix} I encountered an unexpected issue. Please try again or contact support if this persists! 🔧`;
    }
  }

  /**
   * Execute operation with retry logic
   * @private
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    service: string,
    operationName: string
  ): Promise<T> {
    let lastError: any;
    
    for (let attempt = 1; attempt <= this.errorConfig.maxRetries; attempt++) {
      try {
        if (this.isCircuitBreakerOpen(service)) {
          throw new Error(`Circuit breaker open for ${service}`);
        }

        const result = await operation();
        this.recordCircuitBreakerSuccess(service);
        return result;

      } catch (error) {
        lastError = error;
        const errorType = this.categorizeError(error);
        
        this.logger.warn(`${operationName} attempt ${attempt} failed`, {
          service,
          attempt,
          errorType,
          error: error instanceof Error ? error.message : 'Unknown error'
        });

        // Don't retry for certain error types
        if ([ErrorType.AUTHENTICATION_ERROR, ErrorType.VALIDATION_ERROR].includes(errorType)) {
          break;
        }

        // Don't retry on last attempt
        if (attempt === this.errorConfig.maxRetries) {
          break;
        }

        // Exponential backoff with jitter
        const delay = this.errorConfig.retryDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 0.1 * delay;
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
      }
    }

    this.recordCircuitBreakerFailure(service);
    throw lastError;
  }

  /**
   * Update health metrics
   * @private
   */
  private updateHealthMetrics(success: boolean, responseTime: number, errorType?: ErrorType): void {
    this.healthMetrics.totalMessages++;
    
    if (success) {
      this.healthMetrics.successfulResponses++;
    } else {
      this.healthMetrics.failedResponses++;
      if (errorType) {
        this.healthMetrics.errorsByType[errorType]++;
      }
    }

    // Update response time tracking
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > this.MAX_RESPONSE_TIME_SAMPLES) {
      this.responseTimes.shift();
    }

    // Recalculate average response time
    this.healthMetrics.averageResponseTime = 
      this.responseTimes.reduce((sum, time) => sum + time, 0) / this.responseTimes.length;
  }

  /**
   * Get current health status
   */
  getHealthStatus(): HealthMetrics & { circuitBreakers: Record<string, CircuitBreakerState> } {
    return {
      ...this.healthMetrics,
      circuitBreakers: Object.fromEntries(this.circuitBreakers.entries())
    };
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
      if (!this.restClient.isReady) {
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
      this.responseTimes.length = 0;

      // Reset circuit breakers
      this.initializeCircuitBreakers();

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
    return this.executeWithRetry(async () => {
      this.logger.debug('Retrieving thread context', { threadId, channelId });

      try {
        const threadData = await this.restClient.threads.getThreadContext(threadId, channelId, {
          maxMessages: 15, // Get last 15 messages for context
          includeFuture: false // Only include messages up to now
        });

        if (!threadData || threadData.posts.length === 0) {
          this.logger.debug('No thread context found', { threadId, channelId });
          return null;
        }

        this.logger.info('Thread context retrieved successfully', {
          threadId,
          channelId,
          messageCount: threadData.messageCount,
          participantCount: threadData.participantCount,
          isActive: threadData.isActive,
          lastActivity: threadData.lastActivity
        });

        // Return the ThreadContext from ThreadsClient directly - it matches our interface
        return threadData;

      } catch (error) {
        // Log the error but don't fail the entire message processing
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn('Failed to retrieve thread context, continuing without it', {
          threadId,
          channelId,
          error: errorMessage
        });
        return null;
      }

    }, 'thread-context', 'Thread context retrieval');
  }

  
  /**
   * Generate AI response using ElizaOS runtime with comprehensive error handling
   * Enhanced with thread-aware context and better conversation understanding
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
      isThreadReply: boolean;
      threadId: string;
      senderName: string;
      channelName: string;
    }
  ): Promise<AIResponseResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Generating AI response', {
        messageLength: message.length,
        hasContext: !!context,
        contextMessages: context?.messageCount || 0,
        isDirectMessage: metadata.isDirectMessage,
        isMention: metadata.isMention,
        isThreadReply: metadata.isThreadReply,
        threadId: metadata.threadId,
        senderName: metadata.senderName,
        channelName: metadata.channelName
      });

      const result = await this.executeWithRetry(async () => {
        // Build enhanced context for thread-aware responses
        const conversationContext = this.buildConversationContext(message, context, metadata);
        
        // Generate consistent UUIDs for ElizaOS database
        const roomId = createUniqueUuid(this.runtime, metadata.channelId);
        const entityId = createUniqueUuid(this.runtime, metadata.userId);
        const agentId = createUniqueUuid(this.runtime, this.botUserId || 'mattermost-bot');
        const worldId = createUniqueUuid(this.runtime, this.config.env.MATTERMOST_URL || 'mattermost-server');

        // Ensure room exists in ElizaOS database before processing
        await this.runtime.ensureRoomExists({
          id: roomId,
          name: metadata.channelName,
          source: 'mattermost',
          type: metadata.isDirectMessage ? ChannelType.DM : ChannelType.GROUP,
          channelId: metadata.channelId, // Store original Mattermost channel ID
          serverId: this.config.env.MATTERMOST_URL,
          worldId: worldId, // Associate room with world
          metadata: {
            isDirectMessage: metadata.isDirectMessage,
            channelType: metadata.isDirectMessage ? 'D' : 'O',
            platform: 'mattermost'
          }
        });
        
        // Create Memory object for ElizaOS with proper UUID conversion
        const memory: Memory = {
          id: uuidv4() as `${string}-${string}-${string}-${string}-${string}`,
          entityId: entityId,
          agentId: agentId,
          roomId: roomId,
          worldId: worldId, // ✅ FIXED: Add missing worldId field
          content: {
            text: message,
            source: 'mattermost',
            metadata: {
              channelName: metadata.channelName,
              senderName: metadata.senderName,
              isDirectMessage: metadata.isDirectMessage,
              isMention: metadata.isMention,
              isThreadReply: metadata.isThreadReply,
              threadId: metadata.threadId,
              platform: 'mattermost'
            }
          } as Content,
          createdAt: Date.now()
        };

        // Build context for AI response generation using ElizaOS composeState
        const composedState: State = await this.runtime.composeState(memory);

        // Enhance state with conversation context
        const enhancedContext = `${composedState.text || ''}\n\n${conversationContext}\n\n${this.getResponseTemplate(metadata)}`.trim();

        // Generate response using ElizaOS action system instead of direct AI call
        let actionResponse = '';
        const actionCallback: HandlerCallback = async (content) => {
          this.logger.debug('Action callback received', {
            hasText: !!content.text,
            textLength: content.text?.length || 0
          });
          
          if (content.text) {
            actionResponse = content.text;
          }
          return [];
        };

        // Process through action system
        await this.runtime.processActions(
          memory,
          [],
          composedState,
          actionCallback
        );

        // Use action response if available, otherwise fall back to clean response
        let finalResponse = actionResponse;
        
        if (!finalResponse || finalResponse.trim().length === 0) {
          this.logger.info('No action response generated, using clean fallback');
          finalResponse = this.generateFallbackResponse(metadata);
        }

        // Validate and return clean response
        if (!finalResponse) {
          return this.generateFallbackResponse(metadata);
        }

        return finalResponse;

      }, 'ai-generation', 'AI response generation');

      const processingTime = Date.now() - startTime;
      this.updateHealthMetrics(true, processingTime);

      this.logger.info('AI response generated successfully', {
        responseLength: result.length,
        processingTime,
        model: 'ElizaOS-Compose',
        hasContext: !!context,
        contextSize: context?.messageCount || 0
      });

      return {
        success: true,
        response: result,
        model: 'ElizaOS-Compose',
        processingTime
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      const errorType = this.categorizeError(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.updateHealthMetrics(false, processingTime, errorType);
      
      this.logger.error('Failed to generate AI response', error, {
        errorMessage,
        errorType,
        processingTime,
        messageLength: message.length,
        hasContext: !!context
      });

      return {
        success: false,
        error: errorMessage,
        errorType,
        processingTime,
        retryable: ![ErrorType.AUTHENTICATION_ERROR, ErrorType.VALIDATION_ERROR].includes(errorType)
      };
    }
  }

  /**
   * Build comprehensive conversation context for AI response generation
   * @private
   */
  private buildConversationContext(
    currentMessage: string, 
    threadContext: ThreadContext | null, 
    metadata: {
      isDirectMessage: boolean;
      isMention: boolean;
      isThreadReply: boolean;
      channelName: string;
      senderName: string;
    }
  ): string {
    let context = '';

    // Add channel/conversation type context
    if (metadata.isDirectMessage) {
      context += `This is a direct message conversation with ${metadata.senderName}.\n\n`;
    } else if (metadata.isThreadReply) {
      context += `This is a reply in a thread discussion in the #${metadata.channelName} channel.\n\n`;
    } else if (metadata.isMention) {
      context += `You were mentioned in the #${metadata.channelName} channel by ${metadata.senderName}.\n\n`;
    } else {
      context += `This is a message in the #${metadata.channelName} channel.\n\n`;
    }

    // Add thread conversation history if available
    if (threadContext && threadContext.posts.length > 1) {
      context += `Previous conversation in this thread:\n`;
      
      // Show the last few messages for context (limit to prevent token overflow)
      const recentPosts = threadContext.posts.slice(-8); // Last 8 messages
      
      for (const post of recentPosts) {
        const timestamp = new Date(post.create_at).toLocaleTimeString();
        const username = post.username || `User-${post.user_id.slice(-4)}`;
        context += `[${timestamp}] ${username}: ${post.message}\n`;
      }
      context += '\n';
    }

    // Add current message
    context += `Current message from ${metadata.senderName}: ${currentMessage}\n\n`;

    // Add response guidance based on context
    if (metadata.isThreadReply) {
      context += 'Please provide a response that continues the thread conversation naturally and addresses the current message in the context of the previous discussion.';
    } else if (metadata.isMention) {
      context += 'You were specifically mentioned. Please provide a helpful and relevant response.';
    } else if (metadata.isDirectMessage) {
      context += 'This is a private conversation. Respond in a friendly and helpful manner.';
    } else {
      context += 'Provide a helpful response appropriate for the channel discussion.';
    }

    return context;
  }

  /**
   * Get appropriate response template based on conversation context
   * @private
   */
  private getResponseTemplate(metadata: {
    isDirectMessage: boolean;
    isMention: boolean;
    isThreadReply: boolean;
  }): string {
    if (metadata.isDirectMessage) {
      return 'You are a helpful AI assistant in a private conversation. Respond naturally and helpfully to the user\'s message.';
    } else if (metadata.isThreadReply) {
      return 'You are participating in a thread discussion. Continue the conversation naturally, taking into account the previous messages in the thread.';
    } else if (metadata.isMention) {
      return 'You were mentioned in a channel. Provide a helpful response that addresses the mention appropriately.';
    } else {
      return 'You are an AI assistant in a team chat channel. Respond helpfully and appropriately to the conversation.';
    }
  }

  /**
   * Format thread context for ElizaOS State
   * @private
   */
  private formatThreadContextForState(context: ThreadContext): string[] {
    return context.posts.map(post => {
      const username = post.username || `User-${post.user_id.slice(-4)}`;
      return `${username}: ${post.message}`;
    });
  }

  /**
   * Generate clean fallback response with structured error codes
   * @private
   */
  private generateFallbackResponse(
    metadata: {
      userId: string;
      channelId: string;
      isDirectMessage: boolean;
      isMention: boolean;
      isThreadReply: boolean;
      threadId: string;
      senderName: string;
      channelName: string;
    },
    errorCode?: string,
    debugInfo?: any
  ): string {
    // Log structured error for debugging (never shown to user)
    if (errorCode) {
      this.logger.error('Response generation failed', {
        errorCode,
        channelId: metadata.channelId,
        userId: metadata.userId,
        isDirectMessage: metadata.isDirectMessage,
        debugInfo,
        timestamp: new Date().toISOString()
      });
    }

    // User-friendly responses based on context
    const responses = {
      // Error responses with codes (for support debugging)
      'AI_TIMEOUT': "I'm taking a bit longer to respond than usual. Please try again in a moment! ⏱️",
      'ACTION_SYSTEM_ERROR': "I encountered an issue processing your message. Please try rephrasing it! 🔄", 
      'PROVIDER_ERROR': "I'm having trouble accessing some context right now. Please try again! 📡",
      'DATABASE_ERROR': "I'm experiencing some technical difficulties. Please try again shortly! 🔧",
      'VALIDATION_ERROR': "I didn't quite understand that request. Could you try asking differently? 🤔",
      
      // Context-aware fallbacks
      'DEFAULT_DM': metadata.senderName 
        ? `Hi ${metadata.senderName}! I'm here to help. What can I assist you with today? 😊`
        : "Hello! I'm here to help. What can I assist you with? 😊",
      'DEFAULT_CHANNEL': `Hi there! I'm here to help in ${metadata.channelName}. What can I do for you? 👋`,
      'DEFAULT_GENERIC': "I'm here and ready to help! What would you like to know? ✨"
    };

    // Return appropriate response
    if (errorCode && responses[errorCode]) {
      return responses[errorCode];
    }

    // Context-aware fallback
    if (metadata.isDirectMessage) {
      return responses.DEFAULT_DM;
    } else {
      return responses.DEFAULT_CHANNEL;
    }
  }

  /**
   * Post response back to Mattermost with error handling
   * @private
   */
  private async postResponse(
    channelId: string,
    response: string,
    rootId?: string
  ): Promise<void> {
    await this.executeWithRetry(async () => {
      this.logger.info('Posting response to Mattermost', {
        channelId,
        responseLength: response.length,
        isThreadReply: !!rootId
      });

      await this.restClient.posts.createPost(channelId, response, {
        rootId: rootId
      });

      this.logger.info('Response posted successfully', {
        channelId,
        rootId
      });

    }, 'message-posting', 'Message posting');
  }

  /**
   * Handle file generation commands (!generate, !report, !file)
   * @private
   */
  private async handleFileGenerationCommand(post: MattermostPost, eventData: WebSocketPostedEvent): Promise<void> {
    const message = post.message.toLowerCase();
    const channelId = post.channel_id;
    const rootId = post.root_id || post.id;

    this.logger.info('Processing file generation command', {
      postId: post.id,
      channelId,
      command: message.substring(0, 100)
    });

    // Send processing message
    await this.restClient.createPost(
      channelId,
      `🔄 Processing your file generation request...`,
      { rootId }
    );

    // Parse command parameters
    const commandParams = this.parseFileGenerationCommand(message);
    
    this.logger.debug('Parsed command parameters', commandParams);

    try {
      switch (commandParams.type) {
        case 'csv':
          await this.generateCSVFile(channelId, rootId, commandParams);
          break;
        case 'markdown':
        case 'md':
          await this.generateMarkdownFile(channelId, rootId, commandParams);
          break;
        case 'json':
          await this.generateJSONFile(channelId, rootId, commandParams);
          break;
        case 'text':
        case 'txt':
        default:
          await this.generateTextFile(channelId, rootId, commandParams);
          break;
      }

      this.logger.info('File generation command completed successfully', {
        postId: post.id,
        type: commandParams.type,
        filename: commandParams.filename
      });

    } catch (error) {
      this.logger.error('Error in file generation', error, commandParams);
      throw error;
    }
  }

  /**
   * Parse file generation command to extract parameters
   * @private
   */
  private parseFileGenerationCommand(message: string): {
    type: string;
    title: string;
    filename: string;
    content?: string;
    sampleData?: boolean;
  } {
    // Extract file type
    const typeMatch = message.match(/(?:type:|format:|as\s+)([a-z]+)/i);
    const type = typeMatch?.[1]?.toLowerCase() || 'text';

    // Extract title
    const titleMatch = message.match(/(?:title:|name:)\s*["']([^"']+)["']/i) || 
                      message.match(/(?:title:|name:)\s*([a-zA-Z0-9\s-_]+?)(?:\s|$)/i);
    const title = titleMatch?.[1]?.trim() || 'Generated Report';

    // Extract custom content if provided
    const contentMatch = message.match(/(?:content:|with:)\s*["']([^"']+)["']/i);
    const content = contentMatch?.[1];

    // Check if sample data is requested
    const sampleData = message.includes('sample') || message.includes('example') || message.includes('demo');

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const extension = type === 'markdown' || type === 'md' ? 'md' : 
                     type === 'csv' ? 'csv' : 
                     type === 'json' ? 'json' : 'txt';
    const filename = `${cleanTitle}-${timestamp}.${extension}`;

    return {
      type,
      title,
      filename,
      content,
      sampleData
    };
  }

  /**
   * Generate and upload a CSV file
   * @private
   */
  private async generateCSVFile(channelId: string, rootId: string, params: any): Promise<void> {
    // Generate sample CSV data or use provided data
    const data = params.sampleData ? [
      { id: 1, name: 'Alice Johnson', department: 'Engineering', salary: 95000, joinDate: '2022-01-15' },
      { id: 2, name: 'Bob Smith', department: 'Marketing', salary: 75000, joinDate: '2021-08-10' },
      { id: 3, name: 'Carol Davis', department: 'Sales', salary: 82000, joinDate: '2023-03-22' },
      { id: 4, name: 'David Wilson', department: 'Engineering', salary: 98000, joinDate: '2020-11-05' },
      { id: 5, name: 'Eva Brown', department: 'HR', salary: 68000, joinDate: '2022-09-14' }
    ] : [
      { item: 'Sample Item 1', value: 100, category: 'Category A' },
      { item: 'Sample Item 2', value: 200, category: 'Category B' },
      { item: 'Sample Item 3', value: 150, category: 'Category A' }
    ];

    await this.attachmentManager.generateAndUploadCSV(
      channelId,
      data,
      params.filename,
      rootId
    );
  }

  /**
   * Generate and upload a markdown file
   * @private
   */
  private async generateMarkdownFile(channelId: string, rootId: string, params: any): Promise<void> {
    const content = params.content || this.generateSampleMarkdownContent(params.title);
    
    await this.attachmentManager.generateAndUploadMarkdownReport(
      channelId,
      params.title,
      content,
      rootId
    );
  }

  /**
   * Generate and upload a JSON file
   * @private
   */
  private async generateJSONFile(channelId: string, rootId: string, params: any): Promise<void> {
    const data = params.sampleData ? {
      project: params.title,
      metadata: {
        version: '1.0.0',
        created: new Date().toISOString(),
        author: 'Mattermost ElizaOS Bot'
      },
      data: [
        { id: 1, value: 'Sample data 1', status: 'active' },
        { id: 2, value: 'Sample data 2', status: 'inactive' },
        { id: 3, value: 'Sample data 3', status: 'pending' }
      ],
      summary: {
        totalItems: 3,
        activeItems: 1,
        lastUpdated: new Date().toISOString()
      }
    } : {
      title: params.title,
      content: params.content || 'Sample JSON content',
      generated: new Date().toISOString()
    };

    await this.attachmentManager.generateAndUploadJSON(
      channelId,
      data,
      params.filename,
      rootId
    );
  }

  /**
   * Generate and upload a text file
   * @private
   */
  private async generateTextFile(channelId: string, rootId: string, params: any): Promise<void> {
    const content = params.content || this.generateSampleTextContent(params.title);
    
    await this.attachmentManager.generateAndUploadTextFile(
      channelId,
      content,
      params.filename,
      rootId
    );
  }

  /**
   * Generate sample markdown content
   * @private
   */
  private generateSampleMarkdownContent(title: string): string {
    return `## Introduction

This is a sample ${title} generated by the Mattermost ElizaOS Service.

## Overview

This report demonstrates the file generation capabilities of the bot. You can customize the content by specifying:
- File type (markdown, csv, json, text)
- Custom title
- Custom content

## Features

- **Automated File Generation**: Create files on demand
- **Multiple Formats**: Support for various file types
- **Custom Content**: Specify your own content or use samples
- **Secure Upload**: Files are uploaded directly to Mattermost

## Usage Examples

\`\`\`
!generate type:markdown title:"My Report" 
!generate type:csv title:"Employee Data" sample
!generate type:json title:"Config File" 
!file type:text title:"Notes" content:"Custom content here"
\`\`\`

## Conclusion

This feature enables seamless file creation and sharing within your Mattermost workspace.

---
*Generated on: ${new Date().toLocaleString()}*`;
  }

  /**
   * Generate sample text content
   * @private
   */
  private generateSampleTextContent(title: string): string {
    return `${title}
${'='.repeat(title.length)}

Generated on: ${new Date().toLocaleString()}

This is a sample text file created by the Mattermost ElizaOS Service.

FEATURES:
- Automated file generation
- Multiple file format support
- Custom content specification
- Direct Mattermost integration

USAGE:
You can generate files using commands like:
- !generate type:text title:"My File"
- !report type:csv title:"Data Report" sample
- !file type:markdown title:"Documentation"

For custom content, use:
- !generate title:"My File" content:"Your custom content here"

This demonstrates the bot's ability to create and upload files based on user requests.

END OF FILE`;
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
   * Route messages to appropriate handlers with comprehensive error handling and resilience
   * Enhanced with full thread-aware processing
   * @private
   */
  private async routeMessage(processedMessage: ProcessedMessage): Promise<void> {
    const { post, eventData, isDirectMessage, isMention } = processedMessage;
    const startTime = Date.now();

    try {
      this.logger.info('Processing message for AI response', {
        postId: post.id,
        channelId: post.channel_id,
        channelName: eventData.channel_name,
        isDirectMessage,
        isMention,
        isThreadReply: !!post.root_id,
        rootId: post.root_id,
        messagePreview: post.message.substring(0, 100)
      });

      // Mark as processed first to prevent duplicate handling
      this.markMessageProcessed(post.id);

      // Process file attachments if present
      if (post.file_ids && post.file_ids.length > 0) {
        try {
          this.logger.info('Processing file attachments', {
            postId: post.id,
            fileCount: post.file_ids.length,
            fileIds: post.file_ids
          });
          
          // Process files asynchronously - don't wait for completion
          setImmediate(() => {
            this.attachmentManager.processFileAttachments(
              post.file_ids!, 
              post.channel_id, 
              post.id
            ).catch(error => {
              this.logger.error('Error processing file attachments', error, {
                postId: post.id,
                fileIds: post.file_ids
              });
            });
          });
        } catch (error) {
          this.logger.warn('Failed to process file attachments', {
            postId: post.id,
            fileIds: post.file_ids,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Check for file generation commands
      if (post.message.match(/^!generate|^!report|^!file/i)) {
        try {
          this.logger.info('Processing file generation command', {
            postId: post.id,
            command: post.message.substring(0, 50)
          });

          await this.handleFileGenerationCommand(post, eventData);
          
          // Skip normal AI processing for file generation commands
          return;
          
        } catch (error) {
          this.logger.error('Error handling file generation command', error, {
            postId: post.id,
            command: post.message.substring(0, 50)
          });
          
          // Send error message to user
          const errorMessage = `Error generating file: ${error instanceof Error ? error.message : 'Unknown error'}`;
          const fallbackRootId = post.root_id || undefined;
          
          try {
            await this.postResponse(post.channel_id, errorMessage, fallbackRootId);
          } catch (postError) {
            this.logger.error('Failed to send file generation error message', postError);
          }
          
          // Skip normal AI processing after error
          return;
        }
      }

      // Determine thread context and response strategy
      const threadId = post.root_id || post.id;
      let threadContext: ThreadContext | null = null;
      let shouldReplyInThread = false;
      
      // Enhanced thread detection and context gathering
      if (post.root_id) {
        // This is definitely a thread reply
        shouldReplyInThread = true;
        try {
          threadContext = await this.getThreadContext(post.root_id, post.channel_id);
          this.logger.info('Thread context retrieved for reply', {
            threadId: post.root_id,
            contextMessages: threadContext?.messageCount || 0,
            lastMessageTime: threadContext?.posts[threadContext.posts.length - 1]?.create_at
          });
        } catch (error) {
          this.logger.warn('Failed to retrieve thread context for reply, continuing without it', {
            threadId: post.root_id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      } else if (!isDirectMessage) {
        // For channel messages (not DMs), consider starting a new thread if we're mentioned
        // This keeps channel conversations organized
        shouldReplyInThread = isMention;
      }

      // Generate AI response with enhanced context awareness
      const aiResult = await this.generateAIResponse(
        post.message,
        threadContext,
        {
          userId: post.user_id,
          channelId: post.channel_id,
          isDirectMessage,
          isMention,
          isThreadReply: !!post.root_id,
          threadId: threadId,
          senderName: eventData.sender_name,
          channelName: eventData.channel_name
        }
      );

      if (aiResult.success && aiResult.response) {
        try {
          // Post the AI response back to Mattermost with proper threading
          const responseRootId = shouldReplyInThread ? threadId : undefined;
          
          await this.postResponse(
            post.channel_id,
            aiResult.response,
            responseRootId
          );

          this.logger.info('Message processed successfully', {
            postId: post.id,
            responseLength: aiResult.response.length,
            processingTime: aiResult.processingTime,
            totalTime: Date.now() - startTime,
            threadReply: shouldReplyInThread,
            threadId: responseRootId,
            cacheSize: this.processedMessages.size
          });

        } catch (postError) {
          // If posting fails, try to send a simple error message
          const errorType = this.categorizeError(postError);
          const userMessage = this.generateFallbackResponse(
            {
              userId: post.user_id,
              channelId: post.channel_id,
              isDirectMessage,
              isMention,
              isThreadReply: !!post.root_id,
              threadId: post.root_id || post.id,
              senderName: eventData.sender_name,
              channelName: eventData.channel_name
            },
            errorType.toString(),
            { error: postError instanceof Error ? postError.message : String(postError) }
          );
          
          try {
            const fallbackRootId = shouldReplyInThread ? threadId : undefined;
            await this.postResponse(post.channel_id, userMessage, fallbackRootId);
          } catch (fallbackError) {
            this.logger.error('Failed to send fallback error message', fallbackError);
          }
          
          throw postError;
        }

      } else {
        // AI generation failed, send appropriate user message
        const errorType = aiResult.errorType || ErrorType.UNKNOWN_ERROR;
        let userMessage: string;

        if (this.errorConfig.enableFallbackMessages) {
          userMessage = this.generateFallbackResponse(
            {
              userId: post.user_id,
              channelId: post.channel_id,
              isDirectMessage,
              isMention,
              isThreadReply: !!post.root_id,
              threadId: post.root_id || post.id,
              senderName: eventData.sender_name,
              channelName: eventData.channel_name
            },
            errorType.toString(),
            { error: aiResult.error }
          );
        } else {
          userMessage = "I'm temporarily unavailable. Please try again later! 🤖";
        }

        try {
          const fallbackRootId = shouldReplyInThread ? threadId : undefined;
          await this.postResponse(post.channel_id, userMessage, fallbackRootId);
        } catch (fallbackError) {
          this.logger.error('Failed to send error message to user', fallbackError);
        }

        this.logger.warn('Used fallback response due to AI failure', {
          postId: post.id,
          errorType,
          error: aiResult.error,
          retryable: aiResult.retryable
        });
      }

    } catch (error) {
      const errorType = this.categorizeError(error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Error processing message', error, { 
        errorMessage,
        errorType,
        postId: post.id,
        channelId: post.channel_id,
        totalTime: Date.now() - startTime
      });

      // Try to send an error message to the user as last resort
      if (this.errorConfig.enableFallbackMessages) {
        try {
          const userMessage = this.generateFallbackResponse(
            {
              userId: post.user_id,
              channelId: post.channel_id,
              isDirectMessage,
              isMention,
              isThreadReply: !!post.root_id,
              threadId: post.root_id || post.id,
              senderName: eventData.sender_name,
              channelName: eventData.channel_name
            },
            errorType.toString(),
            { error: errorMessage }
          );
          // Determine if we should reply in thread for error messages too
          const errorRootId = (post.root_id || (!isDirectMessage && isMention)) ? (post.root_id || post.id) : undefined;
          await this.postResponse(post.channel_id, userMessage, errorRootId);
        } catch (sendError) {
          this.logger.error('Failed to send final error response', sendError);
        }
      }
    }
  }

  /**
   * Handle 'posted' WebSocket events with comprehensive error handling
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
      let post: MattermostPost;
      try {
        post = JSON.parse(data.post);
      } catch (parseError) {
        this.logger.error('Failed to parse post data', parseError, { 
          postData: data.post?.substring(0, 200) 
        });
        return;
      }
      
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
        // Process message asynchronously to avoid blocking other events
        setImmediate(() => this.routeMessage(processedMessage));
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