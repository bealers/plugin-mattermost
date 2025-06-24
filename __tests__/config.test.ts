import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadConfig,
  getConfig,
  isConfigLoaded,
  resetConfig,
  getMattermostToken,
  hasRequiredCredentials,
  getSafeConfigForLogging
} from '../src/config';
import { 
  credentialManager, 
  SecureCredential,
  redactSensitiveData,
  createSafeErrorMessage 
} from '../src/config/credentials';

describe('Configuration Management - Core Tests', () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
    vi.restoreAllMocks();
  });

  describe('State Management', () => {
    it('should track loaded state correctly', () => {
      expect(isConfigLoaded()).toBe(false);
    });

    it('should reset state properly', () => {
      resetConfig();
      expect(isConfigLoaded()).toBe(false);
    });
  });
});

describe('Secure Credentials', () => {
  beforeEach(() => {
    credentialManager.clear();
  });

  afterEach(() => {
    credentialManager.clear();
  });

  describe('SecureCredential Class', () => {
    it('should store and retrieve values securely', () => {
      const credential = new SecureCredential('secret-value', 'test-credential');

      expect(credential.getValue()).toBe('secret-value');
      expect(credential.getName()).toBe('test-credential');
      expect(credential.isEmpty()).toBe(false);
    });

    it('should prevent accidental exposure', () => {
      const credential = new SecureCredential('secret-value', 'test-credential');

      expect(credential.toString()).toBe('[SecureCredential:test-credential]');
      expect(JSON.stringify(credential)).toBe('"[REDACTED:test-credential]"');
    });

    it('should detect empty credentials', () => {
      const emptyCredential = new SecureCredential('', 'empty');
      expect(emptyCredential.isEmpty()).toBe(true);
    });
  });

  describe('Data Redaction', () => {
    it('should redact sensitive fields', () => {
      const sensitiveData = {
        MATTERMOST_TOKEN: 'secret-token-value',
        username: 'testuser',
        password: 'secret-password'
      };

      const redacted = redactSensitiveData(sensitiveData);

      expect(redacted.MATTERMOST_TOKEN).toMatch(/^se\.\.\.ue$/);
      expect(redacted.username).toBe('testuser');
      expect(redacted.password).toMatch(/^se\.\.\.rd$/);
    });

    it('should handle simple nested objects', () => {
      const nestedData = {
        config: {
          token: 'secret-token-12345'
        }
      };

      const redacted = redactSensitiveData(nestedData);
      expect(redacted.config.token).toMatch(/^se\.\.\.45$/);
    });
  });

  describe('Safe Error Messages', () => {
    it('should create safe error messages', () => {
      const error = new Error('Failed with token: secret-token-123');
      const safeMessage = createSafeErrorMessage(error);

      expect(safeMessage).not.toContain('secret-token-123');
      expect(safeMessage).toContain('[REDACTED]');
    });
  });

  describe('Credential Manager', () => {
    it('should store and retrieve credentials safely', () => {
      credentialManager.setCredential('TEST_TOKEN', 'secret-value', 'test-token');
      
      const credential = credentialManager.getCredential('TEST_TOKEN');
      expect(credential?.getValue()).toBe('secret-value');
      expect(credential?.getName()).toBe('test-token');
    });

    it('should detect missing credentials', () => {
      expect(credentialManager.hasValidCredential('MISSING_TOKEN')).toBe(false);
    });

    it('should clear all credentials', () => {
      credentialManager.setCredential('TOKEN_1', 'secret-1');
      credentialManager.setCredential('TOKEN_2', 'secret-2');

      credentialManager.clear();

      expect(credentialManager.hasValidCredential('TOKEN_1')).toBe(false);
      expect(credentialManager.hasValidCredential('TOKEN_2')).toBe(false);
    });
  });
}); 