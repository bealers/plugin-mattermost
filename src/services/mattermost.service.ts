import { Service, IAgentRuntime, elizaLogger } from '@elizaos/core';

/**
 * Mattermost Service Implementation for ElizaOS 1.x
 * Following the current service architecture instead of deprecated clients
 */
export class MattermostService extends Service {
    static serviceType = 'mattermost';
    capabilityDescription = 'Mattermost platform integration service for message handling';

    private isConnected: boolean = false;

    constructor(runtime?: IAgentRuntime) {
        super(runtime);
    }

    static async start(runtime: IAgentRuntime): Promise<MattermostService> {
        elizaLogger.info('*** STARTING MATTERMOST SERVICE ***');
        
        const service = new MattermostService(runtime);
        
        try {
            // TODO: Initialize Mattermost API client here
            // TODO: Set up WebSocket connection
            // TODO: Set up message event handlers
            
            service.isConnected = true;
            elizaLogger.success('*** MATTERMOST SERVICE STARTED SUCCESSFULLY ***');
            elizaLogger.success('🚀 Mattermost service is now ready!');
            
            return service;
        } catch (error) {
            elizaLogger.error('Failed to start Mattermost service:', error);
            throw error;
        }
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

    // TODO: Add methods for sending messages, handling events, etc.
    async sendMessage(roomId: string, content: string): Promise<void> {
        // Implementation will go here
        elizaLogger.info(`Sending message to room ${roomId}: ${content}`);
    }
}

// Export the plugin using the correct 1.x service architecture
const mattermostPlugin = {
    name: "mattermost",
    description: "Mattermost platform integration service for ElizaOS",
    services: [MattermostService]  // Services, not clients!
};

export default mattermostPlugin;
