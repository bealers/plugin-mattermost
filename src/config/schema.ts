import { z } from 'zod';

/**
 * Environment variable schema for Mattermost plugin configuration
*/
export const envSchema = z.object({
  // Mattermost server configuration
  MATTERMOST_URL: z
    .string()
    .url('Must be a valid URL (e.g., https://chat.example.com)')
    .describe('Mattermost server URL'),
  
  MATTERMOST_TOKEN: z
    .string()
    .min(1, 'Token cannot be empty')
    .describe('Bot user token for Mattermost API authentication'),
  
  MATTERMOST_TEAM: z
    .string()
    .min(1, 'Team name cannot be empty')
    .describe('Default team name for bot operations'),
  
  // Optional configuration with defaults
  MATTERMOST_BOT_USERNAME: z
    .string()
    .optional()
    .default('elizaos-bot')
    .describe('Bot username for display purposes'),
  
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error'])
    .default('info')
    .describe('Logging level for the service'),
  
  // WebSocket configuration
  MATTERMOST_WS_PING_INTERVAL: z
    .string()
    .regex(/^\d+$/, 'Must be a number')
    .transform(val => parseInt(val, 10))
    .default('30000')
    .describe('WebSocket ping interval in milliseconds'),
  
  // Rate limiting
  MATTERMOST_RATE_LIMIT_PER_MINUTE: z
    .string()
    .regex(/^\d+$/, 'Must be a number')
    .transform(val => parseInt(val, 10))
    .default('60')
    .describe('Maximum API requests per minute'),
});

/**
 * Runtime configuration schema for service operation
 * Additional validation for runtime-specific settings
 */
export const runtimeConfigSchema = z.object({
  // Service lifecycle settings
  reconnectAttempts: z
    .number()
    .min(1)
    .max(10)
    .default(3)
    .describe('Maximum WebSocket reconnection attempts'),
  
  reconnectDelay: z
    .number()
    .min(1000)
    .max(60000)
    .default(5000)
    .describe('Delay between reconnection attempts in milliseconds'),
  
  // Message processing
  maxMessageLength: z
    .number()
    .min(1)
    .max(16384)
    .default(4000)
    .describe('Maximum message length in characters'),
  
  // Channel management
  allowedChannelTypes: z
    .array(z.enum(['O', 'P', 'D', 'G']))
    .default(['O', 'P', 'D'])
    .describe('Allowed channel types: O=Open, P=Private, D=Direct, G=Group'),
});

/**
 * Combined configuration schema
 * Merges environment and runtime configurations
 */
export const configSchema = z.object({
  env: envSchema,
  runtime: runtimeConfigSchema,
});

// Type exports for use throughout the application
export type EnvConfig = z.infer<typeof envSchema>;
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type MattermostConfig = z.infer<typeof configSchema>; 