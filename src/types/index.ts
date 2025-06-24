/**
 * Mattermost-specific type definitions
 */

// TODO: Export Mattermost-specific interfaces and types
export interface MattermostConfig {
    serverUrl: string;
    botToken: string;
    botUsername: string;
    webhookToken?: string;
} 