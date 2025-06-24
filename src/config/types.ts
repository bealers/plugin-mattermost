import { z } from 'zod';
import { envSchema, runtimeConfigSchema, configSchema } from './schema';

/**
 * Configuration types for Mattermost plugin
 * Following ElizaOS patterns for type safety
 */

// Base configuration types derived from schemas
export type EnvConfig = z.infer<typeof envSchema>;
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type MattermostConfig = z.infer<typeof configSchema>;

/**
 * Configuration error types for better error handling
 */
export interface ConfigValidationError {
  type: 'validation';
  field: string;
  message: string;
  received?: unknown;
}

export interface ConfigLoadError {
  type: 'load';
  message: string;
  cause?: Error;
}

export type ConfigError = ConfigValidationError | ConfigLoadError;

/**
 * Configuration loading options
 */
export interface ConfigOptions {
  /**
   * Skip environment variable validation
   * Useful for testing scenarios
   */
  skipEnvValidation?: boolean;
  
  /**
   * Override environment variables
   * Useful for testing or programmatic configuration
   */
  envOverrides?: Partial<Record<string, string>>;
  
  /**
   * Runtime configuration overrides
   */
  runtimeOverrides?: Partial<RuntimeConfig>;
}

/**
 * Configuration state for service lifecycle
 */
export interface ConfigState {
  loaded: boolean;
  config?: MattermostConfig;
  errors: ConfigError[];
  lastUpdated?: Date;
}

/**
 * Mattermost channel types enum for type safety
 */
export enum ChannelType {
  OPEN = 'O',
  PRIVATE = 'P', 
  DIRECT = 'D',
  GROUP = 'G',
}

/**
 * Log levels enum matching Zod schema
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
} 