import { IAgentRuntime, elizaLogger, ModelType, Memory, Content, State } from '@elizaos/core';
import { createSafeLogger } from '../config/credentials';
import { MattermostConfig } from '../config';
import { WebSocketClient } from '../clients/websocket.client';
import { RestClient, ThreadContext } from '../clients/rest.client';
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
    restClient: RestClient
  ) {
    this.config = config;
    this.runtime = runtime;
    this.wsClient = wsClient;
    this.restClient = restClient;
    
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
        
        // Create Memory object for ElizaOS
        const memory: Memory = {
          id: uuidv4() as `${string}-${string}-${string}-${string}-${string}`,
          entityId: metadata.userId as `${string}-${string}-${string}-${string}-${string}`,
          agentId: (this.botUserId || 'mattermost-bot') as `${string}-${string}-${string}-${string}-${string}`,
          roomId: metadata.channelId as `${string}-${string}-${string}-${string}-${string}`,
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

        // Create State object with conversation context  
        const state: State = {
          userId: metadata.userId,
          agentId: this.botUserId || 'mattermost-bot',
          roomId: metadata.channelId,
          bio: '', // Bot's bio - could be enhanced
          lore: '', // Bot's background knowledge
          messageDirections: '',
          postDirections: '',
          recentMessages: context ? this.formatThreadContextForState(context) : [],
          recentMessagesData: context?.posts || [],
          goals: [], // Could be enhanced with conversation goals
          goalsData: [],
          actionNames: '', // Available actions
          actions: [], // Action instances
          providers: [], // Available providers
          responseData: {},
          knowledge: conversationContext, // Our enhanced context
          keyEvents: [], // Key conversation events
          // Add missing properties for State interface
          values: {},
          data: {},
          text: ''
        };

        // Generate response using ElizaOS runtime with proper context
        const aiResponse: unknown = await this.runtime.composeState(memory, [
          conversationContext,
          this.getResponseTemplate(metadata)
        ]);

        // Extract and validate response
        let responseText: string;
        if (aiResponse && typeof aiResponse === 'string') {
          const trimmedResponse = aiResponse.trim();
          if (trimmedResponse) {
            responseText = trimmedResponse;
          } else {
            responseText = this.generateFallbackResponse(metadata);
          }
        } else if (aiResponse && typeof aiResponse === 'object' && 'text' in aiResponse) {
          const extractedText = String((aiResponse as any).text || '');
          const trimmedText = extractedText.trim();
          if (trimmedText) {
            responseText = trimmedText;
          } else {
            responseText = this.generateFallbackResponse(metadata);
          }
        } else {
          // Fallback response based on context
          responseText = this.generateFallbackResponse(metadata);
        }

        // Ensure response is not empty
        if (!responseText) {
          responseText = this.generateFallbackResponse(metadata);
        }

        return responseText;

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
   * Generate a contextually appropriate fallback response
   * @private
   */
  private generateFallbackResponse(metadata: {
    isDirectMessage: boolean;
    isMention: boolean;
    isThreadReply: boolean;
    senderName: string;
  }): string {
    if (metadata.isDirectMessage) {
      return `Hi ${metadata.senderName}! I received your message, but I'm having trouble generating a response right now. Could you try rephrasing your question?`;
    } else if (metadata.isThreadReply) {
      return "I'm following this thread discussion, but I'm having trouble generating a response at the moment. Please try again!";
    } else if (metadata.isMention) {
      return `Thanks for mentioning me, ${metadata.senderName}! I'm having some technical difficulties right now, but I'll be back to help soon.`;
    } else {
      return "I'm experiencing some technical issues right now. Please try your request again in a moment!";
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
   * Route a processed message with comprehensive error handling and resilience
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
          const userMessage = this.getUserFriendlyErrorMessage(errorType, isDirectMessage);
          
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
          userMessage = this.getUserFriendlyErrorMessage(errorType, isDirectMessage);
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
          const userMessage = this.getUserFriendlyErrorMessage(errorType, isDirectMessage);
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