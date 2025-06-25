import { IAgentRuntime } from '@elizaos/core';

/**
 * Error severity levels for categorization and handling
 */
export enum ErrorSeverity {
  LOW = 'low',      // Non-critical errors that don't affect functionality
  MEDIUM = 'medium', // Errors that affect some functionality but service can continue
  HIGH = 'high',     // Critical errors that require service restart
}

/**
 * Error details structure for comprehensive error tracking
 */
export interface ErrorDetails {
  message: string;
  code?: string;
  severity: ErrorSeverity;
  source: string;
  timestamp: number;
  originalError?: Error;
  context?: any;
}

/**
 * Service health status interface
 */
export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: number;
  details: {
    wsConnected: boolean;
    apiAvailable: boolean;
    messageManagerReady: boolean;
    errors: ErrorDetails[];
    uptime: number;
    errorCounts: Record<ErrorSeverity, number>;
  };
}

/**
 * Centralized error handler for Mattermost service components
 * Provides consistent error handling, logging, and reporting across the service
 */
export class ErrorHandler {
  private runtime: IAgentRuntime;
  private errors: ErrorDetails[] = [];
  private maxErrorsStored: number = 100;
  private errorCounts: Record<ErrorSeverity, number> = {
    [ErrorSeverity.LOW]: 0,
    [ErrorSeverity.MEDIUM]: 0,
    [ErrorSeverity.HIGH]: 0,
  };
  private serviceStartTime: number;

  constructor(runtime: IAgentRuntime) {
    this.runtime = runtime;
    this.serviceStartTime = Date.now();
  }

  /**
   * Handle an error with appropriate logging and tracking
   */
  handleError(error: Error, options: {
    severity?: ErrorSeverity;
    source: string;
    code?: string;
    context?: any;
  }): ErrorDetails {
    const errorDetails: ErrorDetails = {
      message: error.message,
      code: options.code || 'UNKNOWN_ERROR',
      severity: options.severity || ErrorSeverity.MEDIUM,
      source: options.source,
      timestamp: Date.now(),
      originalError: error,
      context: options.context,
    };

    // Update error counts
    this.errorCounts[errorDetails.severity]++;

    // Log error based on severity
    switch (errorDetails.severity) {
      case ErrorSeverity.LOW:
        this.runtime.logger.warn(`[${options.source}] ${error.message}`, { 
          code: errorDetails.code,
          context: options.context,
        });
        break;
      case ErrorSeverity.HIGH:
        this.runtime.logger.error(`[${options.source}] ${error.message}`, { 
          code: errorDetails.code,
          context: options.context,
          stack: error.stack,
        });
        // Emit error event for critical errors
        this.runtime.emit('MATTERMOST_CRITICAL_ERROR', errorDetails);
        break;
      case ErrorSeverity.MEDIUM:
      default:
        this.runtime.logger.error(`[${options.source}] ${error.message}`, { 
          code: errorDetails.code,
          context: options.context,
        });
        break;
    }

    // Store error for history
    this.errors.unshift(errorDetails);

    // Limit stored errors
    if (this.errors.length > this.maxErrorsStored) {
      this.errors.pop();
    }

    return errorDetails;
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 10): ErrorDetails[] {
    return this.errors.slice(0, limit);
  }

  /**
   * Get error counts by severity
   */
  getErrorCounts(): Record<ErrorSeverity, number> {
    return { ...this.errorCounts };
  }

  /**
   * Get service uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.serviceStartTime;
  }

  /**
   * Clear all stored errors
   */
  clearErrors(): void {
    this.errors = [];
    this.errorCounts = {
      [ErrorSeverity.LOW]: 0,
      [ErrorSeverity.MEDIUM]: 0,
      [ErrorSeverity.HIGH]: 0,
    };
  }

  /**
   * Report service health to ElizaOS runtime
   */
  reportHealth(serviceHealth: ServiceHealth): void {
    this.runtime.emit('MATTERMOST_HEALTH_CHECK', serviceHealth);
    
    // Log health status
    const { status, details } = serviceHealth;
    const message = `Service health: ${status}`;
    const context = {
      wsConnected: details.wsConnected,
      apiAvailable: details.apiAvailable,
      messageManagerReady: details.messageManagerReady,
      errorCount: details.errors.length,
      uptime: details.uptime,
    };

    if (status === 'healthy') {
      this.runtime.logger.info(message, context);
    } else if (status === 'degraded') {
      this.runtime.logger.warn(message, context);
    } else {
      this.runtime.logger.error(message, context);
    }
  }

  /**
   * Create a user-friendly error message for external communication
   */
  createUserFriendlyMessage(error: ErrorDetails, isDirectMessage: boolean = false): string {
    const prefix = isDirectMessage ? "Sorry," : "Apologies,";
    
    switch (error.code) {
      case 'NETWORK_ERROR':
        return `${prefix} I'm having trouble connecting to my services. Please try again in a moment! 🔌`;
      case 'RATE_LIMIT_EXCEEDED':
        return `${prefix} I'm getting a lot of requests right now. Please wait a moment and try again! ⏱️`;
      case 'AI_MODEL_ERROR':
        return `${prefix} my AI brain is having a temporary hiccup. Give me a moment to recover! 🤖`;
      case 'AUTHENTICATION_FAILED':
        return `${prefix} I'm having authentication issues. My admin needs to check my credentials! 🔐`;
      case 'TIMEOUT_ERROR':
        return `${prefix} that took too long to process. Please try asking in a simpler way! ⏰`;
      case 'VALIDATION_ERROR':
        return `${prefix} I didn't understand your message format. Could you rephrase that? 🤔`;
      default:
        return `${prefix} I encountered an unexpected issue. Please try again or contact support if this persists! 🔧`;
    }
  }
} 