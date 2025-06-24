/**
 * Secure credential handling for Mattermost plugin
 */

/**
 * Sensitive field names that should be redacted in logs/errors
 */
const SENSITIVE_FIELDS = new Set([
  'token',
  'password',
  'secret',
  'key',
  'auth',
  'credential',
  'MATTERMOST_TOKEN',
  'MATTERMOST_PASSWORD',
  'API_KEY',
  'BOT_TOKEN',
]);

/**
 * Secured credential wrapper that prevents accidental exposure
 */
export class SecureCredential {
  private readonly value: string;
  private readonly name: string;

  constructor(value: string, name: string = 'credential') {
    this.value = value;
    this.name = name;
  }

  /**
   * Get the actual credential value
   * Only call when you need the real value for API calls
   */
  getValue(): string {
    return this.value;
  }

  /**
   * Get credential name for logging/debugging
   */
  getName(): string {
    return this.name;
  }

  /**
   * Check if credential is empty/invalid
   */
  isEmpty(): boolean {
    return !this.value || this.value.trim().length === 0;
  }

  /**
   * Get length for validation without exposing value
   */
  getLength(): number {
    return this.value.length;
  }

  /**
   * Safe string representation for logs
   */
  toString(): string {
    return `[SecureCredential:${this.name}]`;
  }

  /**
   * Prevent accidental JSON serialization
   */
  toJSON(): string {
    return `[REDACTED:${this.name}]`;
  }

  /**
   * Custom inspect for debugging
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString();
  }
}

/**
 * Credential manager for secure access to sensitive values
 */
export class CredentialManager {
  private credentials = new Map<string, SecureCredential>();

  /**
   * Store a credential securely
   */
  setCredential(key: string, value: string, name?: string): void {
    const credentialName = name || key;
    this.credentials.set(key, new SecureCredential(value, credentialName));
  }

  /**
   * Get a secure credential wrapper
   */
  getCredential(key: string): SecureCredential | undefined {
    return this.credentials.get(key);
  }

  /**
   * Get credential value directly (use sparingly)
   */
  getCredentialValue(key: string): string | undefined {
    return this.credentials.get(key)?.getValue();
  }

  /**
   * Check if credential exists and is valid
   */
  hasValidCredential(key: string): boolean {
    const credential = this.credentials.get(key);
    return credential !== undefined && !credential.isEmpty();
  }

  /**
   * Get all credential names (safe for logging)
   */
  getCredentialNames(): string[] {
    return Array.from(this.credentials.keys());
  }

  /**
   * Clear all credentials (useful for cleanup)
   */
  clear(): void {
    this.credentials.clear();
  }

  /**
   * Safe representation for debugging
   */
  toString(): string {
    const names = this.getCredentialNames();
    return `CredentialManager[${names.length} credentials: ${names.join(', ')}]`;
  }
}

/**
 * Redact sensitive data from any object for safe logging
 */
export function redactSensitiveData(obj: any, maxDepth: number = 3): any {
  if (maxDepth <= 0) {
    return '[MAX_DEPTH_REACHED]';
  }

  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Don't redact short strings or empty strings
    if (obj.length <= 4) {
      return obj;
    }
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof SecureCredential) {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item, maxDepth - 1));
  }

  const redacted: any = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    
    // Check if this field should be redacted
    const shouldRedact = SENSITIVE_FIELDS.has(key) || 
                        SENSITIVE_FIELDS.has(lowerKey) ||
                        Array.from(SENSITIVE_FIELDS).some(field => 
                          lowerKey.includes(field.toLowerCase())
                        );

    if (shouldRedact && typeof value === 'string' && value.length > 0) {
      // Show only first 2 and last 2 characters for tokens/secrets
      if (value.length > 8) {
        redacted[key] = `${value.substring(0, 2)}...${value.substring(value.length - 2)}`;
      } else {
        redacted[key] = '[REDACTED]';
      }
    } else {
      redacted[key] = redactSensitiveData(value, maxDepth - 1);
    }
  }

  return redacted;
}

/**
 * Create a safe error message that doesn't expose credentials
 */
export function createSafeErrorMessage(error: Error, context?: any): string {
  let message = error.message;
  
  // Redact any potential credentials from error message
  for (const field of SENSITIVE_FIELDS) {
    const regex = new RegExp(`${field}[\\s]*[:=][\\s]*[^\\s,}]+`, 'gi');
    message = message.replace(regex, `${field}: [REDACTED]`);
  }

  // Add safe context if provided
  if (context) {
    const safeContext = redactSensitiveData(context);
    message += ` | Context: ${JSON.stringify(safeContext)}`;
  }

  return message;
}

/**
 * Safe logging wrapper that automatically redacts sensitive data
 */
export function createSafeLogger(originalLogger: any) {
  return {
    debug: (message: string, data?: any) => {
      const safeData = data ? redactSensitiveData(data) : undefined;
      originalLogger.debug(message, safeData);
    },
    info: (message: string, data?: any) => {
      const safeData = data ? redactSensitiveData(data) : undefined;
      originalLogger.info(message, safeData);
    },
    warn: (message: string, data?: any) => {
      const safeData = data ? redactSensitiveData(data) : undefined;
      originalLogger.warn(message, safeData);
    },
    error: (message: string, error?: Error, data?: any) => {
      const safeMessage = error ? createSafeErrorMessage(error, data) : message;
      const safeData = data ? redactSensitiveData(data) : undefined;
      originalLogger.error(safeMessage, safeData);
    },
  };
}

// Global credential manager instance
export const credentialManager = new CredentialManager(); 