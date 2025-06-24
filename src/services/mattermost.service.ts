import { Service } from "@elizaos/core";
import type { IAgentRuntime } from "@elizaos/core";
import { 
    loadConfig, 
    isConfigLoaded,
    getSafeConfigForLogging,
    type MattermostConfig 
} from '../config';
import { createSafeLogger } from '../config/credentials';

/**
 * Mattermost Service Implementation
 */
export class MattermostService extends Service {
    static serviceType = 'mattermost';
    capabilityDescription = 'Mattermost platform integration service for message handling';

    private isConnected: boolean = false;
    private config?: MattermostConfig;
    private safeLogger = createSafeLogger(elizaLogger);

    constructor(runtime?: IAgentRuntime) {
        super(runtime);
    }

    static async start(runtime: IAgentRuntime): Promise<MattermostService> {
        const safeLogger = createSafeLogger(elizaLogger);
        safeLogger.info('*** STARTING MATTERMOST SERVICE ***');
        
        const service = new MattermostService(runtime);
        
        try {
            // Load and validate configuration
            safeLogger.info('Loading Mattermost configuration...');
            service.config = loadConfig();
            
            // Log safe configuration for debugging (without secrets)
            safeLogger.info('Configuration loaded successfully', getSafeConfigForLogging());
            
            // Validate that required credentials are available
            if (!isConfigLoaded()) {
                throw new Error('Configuration failed to load properly');
            }
            
            // Initialize service components with configuration
            await service.initializeComponents();
            
            service.isConnected = true;
            safeLogger.info('*** MATTERMOST SERVICE STARTED SUCCESSFULLY ***');
            safeLogger.info('🚀 Mattermost service is now ready!');
            
            return service;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown configuration error';
            safeLogger.error('Failed to start Mattermost service');
            
            // Provide helpful guidance for common issues
            if (errorMessage.includes('MATTERMOST_TOKEN')) {
                safeLogger.error('💡 Check your bot token is set correctly in .env file');
            } else if (errorMessage.includes('MATTERMOST_SERVER_URL')) {
                safeLogger.error('💡 Verify your server URL includes https:// and is accessible');
            } else if (errorMessage.includes('Configuration Error')) {
                // Configuration error already has helpful details, just pass it through
                safeLogger.error(errorMessage);
            }
            
            throw error;
        }
    }

    private async initializeComponents(): Promise<void> {
        if (!this.config) {
            throw new Error('Configuration not loaded');
        }

        this.safeLogger.info('Initializing Mattermost components...');
        
        // TODO: Initialize Mattermost API client
        // TODO: Set up WebSocket connection
        // TODO: Set up message event handlers
        
        this.safeLogger.info('Components initialized');
    }

    getConfiguration(): MattermostConfig {
        if (!this.config) {
            throw new Error('Service not initialized');
        }
        return this.config;
    }

    private getToken(): string {
        try {
            return getMattermostToken();
        } catch (error) {
            this.safeLogger.error('Failed to get token', error);
            throw new Error('Authentication token not available');
        }
    }

    isReady(): boolean {
        return this.isConnected && !!this.config && isConfigLoaded();
    }

    async stop(): Promise<void> {
        elizaLogger.info('*** STOPPING MATTERMOST SERVICE ***');
        
        try {
            // TODO: Clean up WebSocket connections
            // TODO: Clean up API clients
            
            this.isConnected = false;
            elizaLogger.info('*** MATTERMOST SERVICE STOPPED ***');
        } catch (error) {
            elizaLogger.error('Failed to stop Mattermost service:', error);
            throw error;
        }
    }

    async sendMessage(roomId: string, content: string): Promise<void> {
        if (!this.isReady()) {
            throw new Error('Service not ready');
        }
        
        this.safeLogger.info(`Sending message to room ${roomId}`, { contentLength: content.length });
        // TODO: Implement actual message sending
    }
}

const mattermostPlugin = {
    name: "mattermost",
    description: "Mattermost platform integration service",
    services: [MattermostService]
};

export default mattermostPlugin;
