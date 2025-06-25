import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ErrorHandler, ErrorSeverity, ServiceHealth } from '../src/utils/error-handler';
import { MattermostService } from '../src/services/mattermost.service';

// Mock ElizaOS runtime
const mockRuntime = {
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  },
  emit: vi.fn()
};

describe('Error Handling and Service Resilience Integration', () => {
  let errorHandler: ErrorHandler;

  beforeEach(() => {
    errorHandler = new ErrorHandler(mockRuntime as any);
    vi.clearAllMocks();
  });

  afterEach(() => {
    errorHandler.clearErrors();
  });

  describe('ErrorHandler', () => {
    it('should handle errors with different severity levels', () => {
      const testError = new Error('Test error message');

      // Test LOW severity
      const lowError = errorHandler.handleError(testError, {
        severity: ErrorSeverity.LOW,
        source: 'TestComponent',
        code: 'TEST_LOW_ERROR'
      });

      expect(lowError.severity).toBe(ErrorSeverity.LOW);
      expect(lowError.source).toBe('TestComponent');
      expect(lowError.code).toBe('TEST_LOW_ERROR');
      expect(mockRuntime.logger.warn).toHaveBeenCalledWith(
        '[TestComponent] Test error message',
        expect.objectContaining({
          code: 'TEST_LOW_ERROR'
        })
      );

      // Test HIGH severity
      const highError = errorHandler.handleError(testError, {
        severity: ErrorSeverity.HIGH,
        source: 'CriticalComponent',
        code: 'CRITICAL_ERROR'
      });

      expect(highError.severity).toBe(ErrorSeverity.HIGH);
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        '[CriticalComponent] Test error message',
        expect.objectContaining({
          code: 'CRITICAL_ERROR',
          stack: testError.stack
        })
      );
      expect(mockRuntime.emit).toHaveBeenCalledWith('MATTERMOST_CRITICAL_ERROR', highError);
    });

    it('should track error counts by severity', () => {
      const testError = new Error('Test error');

      errorHandler.handleError(testError, {
        severity: ErrorSeverity.LOW,
        source: 'Test',
        code: 'TEST_1'
      });
      errorHandler.handleError(testError, {
        severity: ErrorSeverity.HIGH,
        source: 'Test',
        code: 'TEST_2'
      });
      errorHandler.handleError(testError, {
        severity: ErrorSeverity.HIGH,
        source: 'Test',
        code: 'TEST_3'
      });

      const counts = errorHandler.getErrorCounts();
      expect(counts[ErrorSeverity.LOW]).toBe(1);
      expect(counts[ErrorSeverity.MEDIUM]).toBe(0);
      expect(counts[ErrorSeverity.HIGH]).toBe(2);
    });

    it('should generate user-friendly error messages', () => {
      const errorDetails = {
        message: 'Network connection failed',
        code: 'NETWORK_ERROR',
        severity: ErrorSeverity.MEDIUM,
        source: 'WebSocketClient',
        timestamp: Date.now()
      };

      const dmMessage = errorHandler.createUserFriendlyMessage(errorDetails, true);
      const channelMessage = errorHandler.createUserFriendlyMessage(errorDetails, false);

      expect(dmMessage).toContain('Sorry,');
      expect(channelMessage).toContain('Apologies,');
      expect(dmMessage).toContain('trouble connecting');
      expect(channelMessage).toContain('trouble connecting');
    });

    it('should report service health to ElizaOS runtime', () => {
      const healthStatus: ServiceHealth = {
        status: 'healthy',
        lastCheck: Date.now(),
        details: {
          wsConnected: true,
          apiAvailable: true,
          messageManagerReady: true,
          errors: [],
          uptime: 60000,
          errorCounts: { low: 0, medium: 0, high: 0 }
        }
      };

      errorHandler.reportHealth(healthStatus);

      expect(mockRuntime.emit).toHaveBeenCalledWith('MATTERMOST_HEALTH_CHECK', healthStatus);
      expect(mockRuntime.logger.info).toHaveBeenCalledWith(
        'Service health: healthy',
        expect.objectContaining({
          wsConnected: true,
          apiAvailable: true,
          messageManagerReady: true
        })
      );
    });

    it('should handle degraded and unhealthy status reporting', () => {
      const degradedStatus: ServiceHealth = {
        status: 'degraded',
        lastCheck: Date.now(),
        details: {
          wsConnected: false,
          apiAvailable: true,
          messageManagerReady: false,
          errors: [],
          uptime: 30000,
          errorCounts: { low: 2, medium: 1, high: 0 }
        }
      };

      const unhealthyStatus: ServiceHealth = {
        status: 'unhealthy',
        lastCheck: Date.now(),
        details: {
          wsConnected: false,
          apiAvailable: false,
          messageManagerReady: false,
          errors: [],
          uptime: 10000,
          errorCounts: { low: 1, medium: 3, high: 2 }
        }
      };

      errorHandler.reportHealth(degradedStatus);
      errorHandler.reportHealth(unhealthyStatus);

      expect(mockRuntime.logger.warn).toHaveBeenCalledWith(
        'Service health: degraded',
        expect.any(Object)
      );
      expect(mockRuntime.logger.error).toHaveBeenCalledWith(
        'Service health: unhealthy',
        expect.any(Object)
      );
    });

    it('should track uptime correctly', () => {
      const creationTime = Date.now();
      const handler = new ErrorHandler(mockRuntime as any);

      // Wait a bit
      const delay = 100;
      setTimeout(() => {
        const uptime = handler.getUptime();
        expect(uptime).toBeGreaterThanOrEqual(delay);
        expect(uptime).toBeLessThan(delay + 50); // Allow some margin
      }, delay);
    });

    it('should store and retrieve recent errors', () => {
      const errors = [
        new Error('Error 1'),
        new Error('Error 2'),
        new Error('Error 3')
      ];

      errors.forEach((error, index) => {
        errorHandler.handleError(error, {
          severity: ErrorSeverity.MEDIUM,
          source: 'Test',
          code: `ERROR_${index + 1}`
        });
      });

      const recentErrors = errorHandler.getRecentErrors(2);
      expect(recentErrors).toHaveLength(2);
      expect(recentErrors[0].message).toBe('Error 3'); // Most recent first
      expect(recentErrors[1].message).toBe('Error 2');
    });

    it('should limit stored errors to maximum count', () => {
      const maxErrors = 100;
      
      // Add more than max errors
      for (let i = 0; i < maxErrors + 10; i++) {
        errorHandler.handleError(new Error(`Error ${i}`), {
          severity: ErrorSeverity.LOW,
          source: 'Test',
          code: `ERROR_${i}`
        });
      }

      const allErrors = errorHandler.getRecentErrors(200);
      expect(allErrors).toHaveLength(maxErrors);
      // Should have the most recent errors
      expect(allErrors[0].message).toBe(`Error ${maxErrors + 9}`);
    });

    it('should clear errors and counts', () => {
      const testError = new Error('Test error');

      errorHandler.handleError(testError, {
        severity: ErrorSeverity.HIGH,
        source: 'Test',
        code: 'TEST_ERROR'
      });

      expect(errorHandler.getRecentErrors()).toHaveLength(1);
      expect(errorHandler.getErrorCounts()[ErrorSeverity.HIGH]).toBe(1);

      errorHandler.clearErrors();

      expect(errorHandler.getRecentErrors()).toHaveLength(0);
      expect(errorHandler.getErrorCounts()[ErrorSeverity.HIGH]).toBe(0);
    });
  });

  describe('Error Code to User Message Mapping', () => {
    const errorCodes = [
      'NETWORK_ERROR',
      'RATE_LIMIT_EXCEEDED', 
      'AI_MODEL_ERROR',
      'AUTHENTICATION_FAILED',
      'TIMEOUT_ERROR',
      'VALIDATION_ERROR',
      'UNKNOWN_ERROR'
    ];

    errorCodes.forEach(code => {
      it(`should handle ${code} with appropriate user message`, () => {
        const errorDetails = {
          message: `Test ${code}`,
          code,
          severity: ErrorSeverity.MEDIUM,
          source: 'Test',
          timestamp: Date.now()
        };

        const dmMessage = errorHandler.createUserFriendlyMessage(errorDetails, true);
        const channelMessage = errorHandler.createUserFriendlyMessage(errorDetails, false);

        expect(dmMessage).toBeTruthy();
        expect(channelMessage).toBeTruthy();
        expect(dmMessage).toContain('Sorry,');
        expect(channelMessage).toContain('Apologies,');
        
        // Verify specific content based on error code
        switch (code) {
          case 'NETWORK_ERROR':
            expect(dmMessage).toContain('trouble connecting');
            break;
          case 'RATE_LIMIT_EXCEEDED':
            expect(dmMessage).toContain('getting a lot of requests');
            break;
          case 'AI_MODEL_ERROR':
            expect(dmMessage).toContain('AI brain');
            break;
          case 'AUTHENTICATION_FAILED':
            expect(dmMessage).toContain('authentication issues');
            break;
          case 'TIMEOUT_ERROR':
            expect(dmMessage).toContain('took too long');
            break;
          case 'VALIDATION_ERROR':
            expect(dmMessage).toContain("didn't understand");
            break;
          case 'UNKNOWN_ERROR':
            expect(dmMessage).toContain('unexpected issue');
            break;
        }
      });
    });
  });

  describe('ElizaOS Runtime Integration', () => {
    it('should emit events with correct data structure', () => {
      const testError = new Error('Critical test error');
      
      errorHandler.handleError(testError, {
        severity: ErrorSeverity.HIGH,
        source: 'IntegrationTest',
        code: 'CRITICAL_TEST_ERROR',
        context: { testData: 'value' }
      });

      expect(mockRuntime.emit).toHaveBeenCalledWith(
        'MATTERMOST_CRITICAL_ERROR',
        expect.objectContaining({
          message: 'Critical test error',
          code: 'CRITICAL_TEST_ERROR',
          severity: ErrorSeverity.HIGH,
          source: 'IntegrationTest',
          timestamp: expect.any(Number),
          originalError: testError,
          context: { testData: 'value' }
        })
      );
    });

    it('should handle runtime without logger gracefully', () => {
      const runtimeWithoutLogger = {
        emit: vi.fn()
      };

      expect(() => {
        new ErrorHandler(runtimeWithoutLogger as any);
      }).not.toThrow();
    });
  });
});

describe('Service Integration Scenarios', () => {
  it('should demonstrate typical error flow in service operations', () => {
    const handler = new ErrorHandler(mockRuntime as any);

    // Simulate typical service error scenarios
    
    // 1. WebSocket connection failure
    handler.handleError(new Error('Connection refused'), {
      severity: ErrorSeverity.HIGH,
      source: 'WebSocketClient.connect',
      code: 'WEBSOCKET_CONNECTION_FAILED',
      context: { attempt: 1, maxAttempts: 5 }
    });

    // 2. API rate limiting
    handler.handleError(new Error('Rate limit exceeded'), {
      severity: ErrorSeverity.LOW,
      source: 'RestClient.apiCall',
      code: 'RATE_LIMIT_EXCEEDED',
      context: { remainingTime: 30 }
    });

    // 3. Message processing error
    handler.handleError(new Error('Failed to generate AI response'), {
      severity: ErrorSeverity.MEDIUM,
      source: 'MessageManager.processMessage',
      code: 'AI_MODEL_ERROR',
      context: { messageId: 'msg123', channelId: 'ch456' }
    });

    const errors = handler.getRecentErrors();
    expect(errors).toHaveLength(3);
    
    const counts = handler.getErrorCounts();
    expect(counts[ErrorSeverity.LOW]).toBe(1);
    expect(counts[ErrorSeverity.MEDIUM]).toBe(1);
    expect(counts[ErrorSeverity.HIGH]).toBe(1);

    // Verify critical error was emitted
    expect(mockRuntime.emit).toHaveBeenCalledWith(
      'MATTERMOST_CRITICAL_ERROR',
      expect.objectContaining({
        code: 'WEBSOCKET_CONNECTION_FAILED'
      })
    );
  });
}); 