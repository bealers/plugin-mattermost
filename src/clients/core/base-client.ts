import MattermostClient from '@mattermost/client';
import { MattermostConfig } from '../../config';
import { RateLimiter } from './rate-limiter';

/**
 * Retry configuration for API operations
 */
interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  exponentialBase?: number;
  retryableErrors?: string[];
}

/**
 * Custom error class for Mattermost API errors with retry information
 */
export class MattermostApiError extends Error {
  public readonly statusCode?: number;
  public readonly retryable: boolean;
  public readonly originalError: any;

  constructor(message: string, statusCode?: number, originalError?: any) {
    super(message);
    this.name = 'MattermostApiError';
    this.statusCode = statusCode;
    this.originalError = originalError;
    this.retryable = this.isRetryableError(statusCode, message);
  }

  private isRetryableError(statusCode?: number, message?: string): boolean {
    // Network errors (no status code) are generally retryable
    if (!statusCode) return true;
    
    // HTTP status codes that are retryable
    const retryableStatusCodes = [429, 500, 502, 503, 504];
    if (retryableStatusCodes.includes(statusCode)) return true;
    
    // Rate limit errors (even if not 429) are retryable
    if (message && (
      message.toLowerCase().includes('rate limit') ||
      message.toLowerCase().includes('too many requests')
    )) {
      return true;
    }
    
    return false;
  }
}

/**
 * Generic retry wrapper with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  operationName: string,
  logger: any,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    exponentialBase = 2,
    retryableErrors = []
  } = options;

  const rateLimiter = RateLimiter.getInstance();

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      await rateLimiter.checkRateLimit();
      const result = await operation();
      
      if (attempt > 1) {
        logger.info(`${operationName} succeeded on attempt ${attempt}`);
      }
      
      return result;
    } catch (error) {
      const isLastAttempt = attempt === maxRetries + 1;
      
      let shouldRetry = false;
      if (!isLastAttempt) {
        if (error instanceof MattermostApiError) {
          shouldRetry = error.retryable;
        } else if (error instanceof Error) {
          // Check if error message contains retryable patterns
          const errorMessage = error.message.toLowerCase();
          shouldRetry = retryableErrors.some(pattern => 
            errorMessage.includes(pattern.toLowerCase())
          ) || errorMessage.includes('network') || errorMessage.includes('timeout');
        }
      }

      if (!shouldRetry || isLastAttempt) {
        logger.error(`${operationName} failed after ${attempt} attempt(s)`, error);
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const delay = Math.min(
        baseDelay * Math.pow(exponentialBase, attempt - 1),
        maxDelay
      );
      const jitteredDelay = delay + Math.random() * 1000; // Add up to 1s jitter

      logger.warn(`${operationName} attempt ${attempt} failed, retrying in ${Math.round(jitteredDelay)}ms`, {
        error: error instanceof Error ? error.message : String(error),
        attempt,
        nextDelay: Math.round(jitteredDelay)
      });

      await new Promise(resolve => setTimeout(resolve, jitteredDelay));
    }
  }

  throw new Error(`${operationName} failed after maximum retries`);
}

/**
 * Base client class with shared functionality for all Mattermost API clients
 */
export abstract class BaseClient {
  protected client: InstanceType<typeof MattermostClient.Client4>;
  protected config: MattermostConfig;
  protected logger: any;

  constructor(client: InstanceType<typeof MattermostClient.Client4>, config: MattermostConfig, logger: any) {
    this.client = client;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Create a standardized API error with context
   */
  protected createApiError(error: any, contextMessage: string): MattermostApiError {
    let statusCode: number | undefined;
    let message = contextMessage;

    if (error?.response?.status) {
      statusCode = error.response.status;
    } else if (error?.status_code) {
      statusCode = error.status_code;
    }

    if (error?.response?.data?.message) {
      message += `: ${error.response.data.message}`;
    } else if (error?.message) {
      message += `: ${error.message}`;
    } else if (typeof error === 'string') {
      message += `: ${error}`;
    }

    return new MattermostApiError(message, statusCode, error);
  }

  /**
   * Execute operation with retry logic and error handling
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    options?: RetryOptions
  ): Promise<T> {
    return withRetry(operation, operationName, this.logger, options);
  }
} 