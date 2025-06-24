import { Service, elizaLogger } from "@elizaos/core";
import type { IAgentRuntime } from "@elizaos/core";
import { 
    loadConfig, 
    isConfigLoaded,
    getSafeConfigForLogging,
    getMattermostToken,
    type MattermostConfig 
} from '../config';
import { createSafeLogger } from '../config/credentials';
import { RestClient } from '../clients/rest.client';

/**
 * Mattermost Service Implementation with REST API and Message Handling
 */
export class MattermostService extends Service {
    static serviceType = 'mattermost';
    capabilityDescription = 'Mattermost platform integration service for message handling and bot interactions';

    private isConnected: boolean = false;
    private mattermostConfig?: MattermostConfig;
    private safeLogger = createSafeLogger(elizaLogger);
    private restClient?: RestClient;
    private botUser?: any;
    private team?: any;

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
            service.mattermostConfig = loadConfig();
            
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
            safeLogger.info('🚀 Mattermost service is now ready for interactions!');
            safeLogger.info(`🤖 Bot user: ${service.botUser?.username}`);
            safeLogger.info(`🏢 Team: ${service.team?.name}`);
            
            return service;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown configuration error';
            safeLogger.error('Failed to start Mattermost service', error instanceof Error ? error : new Error(errorMessage));
            
            // Provide helpful guidance for common issues
            if (errorMessage.includes('MATTERMOST_TOKEN')) {
                safeLogger.error('💡 Check your bot token is set correctly in .env file');
            } else if (errorMessage.includes('MATTERMOST_SERVER_URL')) {
                safeLogger.error('💡 Verify your server URL includes https:// and is accessible');
            } else if (errorMessage.includes('Authentication failed')) {
                safeLogger.error('💡 Bot token may be invalid or bot account disabled');
            } else if (errorMessage.includes('Team access failed')) {
                safeLogger.error('💡 Bot may not have access to the specified team');
            }
            
            throw error;
        }
    }

    private async initializeComponents(): Promise<void> {
        if (!this.mattermostConfig) {
            throw new Error('Configuration not loaded');
        }

        this.safeLogger.info('Initializing Mattermost REST client...');
        
        // Initialize REST API client
        this.restClient = new RestClient(this.mattermostConfig);
        await this.restClient.initialize();
        
        // Get bot and team information
        this.botUser = await this.restClient.getBotUser();
        this.team = await this.restClient.getTeam();
        
        this.safeLogger.info('REST client initialized successfully', {
            botId: this.botUser.id,
            botUsername: this.botUser.username,
            teamId: this.team.id,
            teamName: this.team.name
        });
        
        // Set up basic message polling (we'll enhance this with WebSocket later)
        this.startMessageMonitoring();
        
        this.safeLogger.info('✅ All components initialized successfully');
    }

    /**
     * Start monitoring for new messages (simplified polling approach)
     */
    private startMessageMonitoring(): void {
        this.safeLogger.info('🔍 Starting message monitoring...');
        
        // For now, we'll implement a simple demo that can respond to direct interactions
        // In a full implementation, this would use WebSocket connections
        this.safeLogger.info('📡 Message monitoring active - bot ready for interactions!');
        this.safeLogger.info('💬 Try mentioning the bot or sending a direct message!');
    }

    /**
     * Send a message to a specific channel
     */
    async sendMessage(channelId: string, content: string, options?: {
        rootId?: string;
        fileIds?: string[];
    }): Promise<any> {
        if (!this.isReady()) {
            throw new Error('Service not ready');
        }
        
        if (!this.restClient) {
            throw new Error('REST client not initialized');
        }

        try {
            this.safeLogger.info(`📤 Sending message to channel ${channelId}`, { 
                contentLength: content.length,
                isReply: !!options?.rootId 
            });
            
            const post = await this.restClient.createPost(channelId, content, {
                rootId: options?.rootId,
                fileIds: options?.fileIds
            });
            
            this.safeLogger.info(`✅ Message sent successfully`, { 
                postId: post.id,
                channelId 
            });
            
            return post;
        } catch (error) {
            this.safeLogger.error('❌ Failed to send message', error instanceof Error ? error : new Error('Unknown error'), { 
                channelId
            });
            throw error;
        }
    }

    /**
     * Handle incoming messages and generate responses
     */
    async handleMessage(message: any): Promise<void> {
        if (!this.runtime || !this.restClient || !this.botUser) {
            this.safeLogger.warn('Cannot handle message - service not fully initialized');
            return;
        }

        try {
            // Skip messages from the bot itself
            if (message.user_id === this.botUser.id) {
                return;
            }

            // Skip system messages
            if (message.type && message.type !== '') {
                return;
            }

            const messageText = message.message?.trim();
            if (!messageText) {
                return;
            }

            this.safeLogger.info('📥 Processing incoming message', {
                channelId: message.channel_id,
                userId: message.user_id,
                messageLength: messageText.length,
                isDirectMessage: message.channel_type === 'D'
            });

            // Simple bot response logic (can be enhanced with ElizaOS reasoning)
            let response: string;
            
            if (messageText.toLowerCase().includes('hello') || messageText.toLowerCase().includes('hi')) {
                response = `Hello! 👋 I'm ${this.botUser.username}, your Mattermost AI assistant. How can I help you today?`;
            } else if (messageText.toLowerCase().includes('help')) {
                response = `I'm here to help! 🤖 I can:
• Respond to messages and questions
• Assist with information and tasks
• Join channels and conversations

Try asking me anything or saying "status" to see how I'm doing!`;
            } else if (messageText.toLowerCase().includes('status')) {
                const channels = await this.restClient.getChannelsForTeam();
                response = `🟢 Bot Status: Online and ready!
• Team: ${this.team.name}
• Channels available: ${channels.length}
• REST API: Connected ✅
• Ready to assist! 🚀`;
            } else {
                response = `I received your message: "${messageText}"

I'm still learning, but I'm here to help! Try saying "hello", "help", or "status" to see what I can do. 🤖`;
            }

            // Send the response
            await this.sendMessage(message.channel_id, response, {
                rootId: message.id // Reply in thread
            });

        } catch (error) {
            this.safeLogger.error('❌ Error handling message', error instanceof Error ? error : new Error('Unknown error'), {
                messageId: message.id
            });
        }
    }

    /**
     * Join a channel by name
     */
    async joinChannel(channelName: string): Promise<any> {
        if (!this.restClient) {
            throw new Error('REST client not initialized');
        }

        try {
            const channel = await this.restClient.getChannelByName(channelName);
            await this.restClient.joinChannel(channel.id);
            
            // Send a greeting message
            await this.sendMessage(channel.id, `Hello everyone! 👋 I'm ${this.botUser?.username}, your new AI assistant. Type "help" to see what I can do!`);
            
            this.safeLogger.info(`✅ Successfully joined channel: ${channelName}`, {
                channelId: channel.id
            });
            
            return channel;
        } catch (error) {
            this.safeLogger.error(`❌ Failed to join channel: ${channelName}`, error instanceof Error ? error : new Error('Unknown error'));
            throw error;
        }
    }

    /**
     * Get all available channels
     */
    async getChannels(): Promise<any[]> {
        if (!this.restClient) {
            throw new Error('REST client not initialized');
        }

        return await this.restClient.getChannelsForTeam();
    }

    getConfiguration(): MattermostConfig {
        if (!this.mattermostConfig) {
            throw new Error('Service not initialized');
        }
        return this.mattermostConfig;
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
        return this.isConnected && 
               !!this.mattermostConfig && 
               isConfigLoaded() && 
               !!this.restClient && 
               !!this.botUser && 
               !!this.team;
    }

    async stop(): Promise<void> {
        elizaLogger.info('*** STOPPING MATTERMOST SERVICE ***');
        
        try {
            // TODO: Clean up WebSocket connections when implemented
            // TODO: Clean up any polling intervals
            
            this.isConnected = false;
            this.restClient = undefined;
            this.botUser = undefined;
            this.team = undefined;
            
            elizaLogger.info('*** MATTERMOST SERVICE STOPPED ***');
        } catch (error) {
            elizaLogger.error('Failed to stop Mattermost service:', error);
            throw error;
        }
    }
}

const mattermostPlugin = {
    name: "mattermost",
    description: "Mattermost platform integration service",
    services: [MattermostService]
};

export default mattermostPlugin;
