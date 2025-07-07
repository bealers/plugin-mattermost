import { z } from 'zod';
import { envSchema, runtimeConfigSchema, configSchema } from './schema';
import type { 
  MattermostConfig, 
  ConfigOptions, 
  ConfigError, 
  ConfigState,
  EnvConfig,
  RuntimeConfig 
} from './types';
import { 
  credentialManager, 
  redactSensitiveData, 
  createSafeErrorMessage 
} from './credentials';

/**
 * Configuration manager for Mattermost plugin
  */
class ConfigManager {
  private state: ConfigState = {
    loaded: false,
    errors: [],
  };

  /**
   * Load and validate configuration
   */
  public loadConfig(options: ConfigOptions = {}): MattermostConfig {
    try {
      this.state.errors = [];
      
      // Prepare environment variables
      const envVars = {
        ...process.env,
        ...options.envOverrides,
      };

      // Validate environment configuration
      let envConfig: EnvConfig;
      if (options.skipEnvValidation) {
        envConfig = envVars as EnvConfig;
      } else {
        envConfig = this.validateEnvironment(envVars);
      }

      // Store sensitive credentials securely
      this.storeSensitiveCredentials(envConfig);

      // Prepare runtime configuration with defaults and overrides
      const runtimeConfig: RuntimeConfig = {
        ...runtimeConfigSchema.parse({}), // Apply defaults
        ...options.runtimeOverrides,
      };

      // Combine configurations
      const config: MattermostConfig = {
        env: envConfig,
        runtime: runtimeConfig,
      };

      // Validate combined configuration
      const validatedConfig = configSchema.parse(config);

      // Update state
      this.state = {
        loaded: true,
        config: validatedConfig,
        errors: [],
        lastUpdated: new Date(),
      };

      return validatedConfig;
    } catch (error) {
      const configError = this.handleConfigError(error);
      this.state.errors.push(configError);
      const safeErrorMessage = createSafeErrorMessage(
        new Error(`Configuration loading failed: ${configError.message}`)
      );
      throw new Error(safeErrorMessage);
    }
  }

  /**
   * Validate environment variables with descriptive errors
   */
  private validateEnvironment(envVars: Record<string, string | undefined>): EnvConfig {
    try {
      return envSchema.parse(envVars);
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Create actionable error messages for common issues
        const errorMessages = error.errors.map(err => {
          const field = err.path.join('.');
          let message = `${field}: ${err.message}`;
          
          // Add helpful context for common fields
          if (field === 'MATTERMOST_TOKEN') {
            message += '\n  → Get this from your Mattermost System Console → Integrations → Bot Accounts';
          } else if (field === 'MATTERMOST_URL') {
            message += '\n  → Example: https://chat.example.com (include https://)';
          }
          
          return message;
        });
        
        const helpText = '\n\nQuick fix: Create a .env file with:\nMATTERMOST_URL=https://your-server.com\nMATTERMOST_TOKEN=your-bot-token';
        
        throw new Error(`Configuration Error:\n${errorMessages.join('\n')}${helpText}`);
      }
      throw error;
    }
  }

  /**
   * Store sensitive credentials securely
   */
  private storeSensitiveCredentials(envConfig: EnvConfig): void {
    // Store the Mattermost token securely
    credentialManager.setCredential(
      'MATTERMOST_TOKEN', 
      envConfig.MATTERMOST_TOKEN, 
      'mattermost-bot-token'
    );

    // Store any other sensitive fields that might be added in the future
    // This pattern makes it easy to add more secure credential storage
  }

  /**
   * Handle configuration errors without exposing sensitive data
   */
  private handleConfigError(error: unknown): ConfigError {
    if (error instanceof z.ZodError) {
      // Return first validation error with sanitized details
      const firstError = error.errors[0];
      return {
        type: 'validation',
        field: firstError.path.join('.'),
        message: firstError.message,
        // Note: We don't include 'received' to avoid exposing sensitive values
      };
    }

    if (error instanceof Error) {
      return {
        type: 'load',
        message: error.message,
        cause: error,
      };
    }

    return {
      type: 'load',
      message: 'Unknown configuration error',
    };
  }

  /**
   * Get current configuration state
   * Following ElizaOS pattern for state inspection
   */
  public getState(): Readonly<ConfigState> {
    return { ...this.state };
  }

  /**
   * Check if configuration is loaded and valid
   */
  public isLoaded(): boolean {
    return this.state.loaded && !!this.state.config && this.state.errors.length === 0;
  }

  /**
   * Get configuration or throw if not loaded
   * Following ElizaOS pattern for safe access
   */
  public getConfig(): MattermostConfig {
    if (!this.isLoaded() || !this.state.config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this.state.config;
  }

  /**
   * Reset configuration state
   * Useful for testing and reloading
   */
  public reset(): void {
    this.state = {
      loaded: false,
      errors: [],
    };
  }
}

// Singleton instance for application-wide use
const configManager = new ConfigManager();

/**
 * Load configuration with options
 * Primary function for initializing configuration
 */
export function loadConfig(options?: ConfigOptions): MattermostConfig {
  return configManager.loadConfig(options);
}

/**
 * Get current configuration
 * Throws if configuration is not loaded
 */
export function getConfig(): MattermostConfig {
  return configManager.getConfig();
}

/**
 * Check if configuration is loaded
 */
export function isConfigLoaded(): boolean {
  return configManager.isLoaded();
}

/**
 * Get configuration state for debugging
 */
export function getConfigState(): Readonly<ConfigState> {
  return configManager.getState();
}

/**
 * Reset configuration (primarily for testing)
 */
export function resetConfig(): void {
  configManager.reset();
  credentialManager.clear();
}

/**
 * Get secure credential for Mattermost token
 * Following ElizaOS pattern for secure credential access
 */
export function getMattermostToken(): string {
  const credential = credentialManager.getCredentialValue('MATTERMOST_TOKEN');
  if (!credential) {
    throw new Error('Mattermost token not loaded. Ensure configuration is loaded first.');
  }
  return credential;
}

/**
 * Check if required credentials are available
 */
export function hasRequiredCredentials(): boolean {
  return credentialManager.hasValidCredential('MATTERMOST_TOKEN');
}

/**
 * Get safe configuration for logging/debugging
 * Automatically redacts sensitive information
 */
export function getSafeConfigForLogging(): any {
  const state = configManager.getState();
  return redactSensitiveData(state);
}

// Re-export types and schemas for external use
export type { 
  MattermostConfig, 
  ConfigOptions, 
  ConfigError, 
  ConfigState,
  EnvConfig,
  RuntimeConfig 
} from './types';
export * from './schema';
export * from './credentials';

// Export default configuration loader for convenience
export default {
  load: loadConfig,
  get: getConfig,
  isLoaded: isConfigLoaded,
  getState: getConfigState,
  reset: resetConfig,
  getToken: getMattermostToken,
  hasCredentials: hasRequiredCredentials,
  getSafeConfig: getSafeConfigForLogging,
}; 