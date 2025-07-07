/**
 * Mattermost-specific type definitions
 */
export interface MattermostConfig {
    serverUrl: string;
    botToken: string;
    botUsername: string;
    webhookToken?: string;
} 