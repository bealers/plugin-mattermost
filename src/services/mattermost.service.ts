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
import { WebSocketClient } from '../clients/websocket.client';
import { MessageManager } from '../managers/message.manager';
import { ChannelManager } from '../managers/channel.manager';
import { ErrorHandler, ErrorSeverity, ServiceHealth } from '../utils/error-handler';

/**
 * Enhanced Mattermost Service with comprehensive error handling and resilience
 */
export class MattermostService extends Service {
    static serviceType = 'mattermost';
    capabilityDescription = 'Mattermost platform integration service with real-time messaging, error handling, and resilience';

    private isConnected: boolean = false;
    private mattermostConfig?: MattermostConfig;
    private safeLogger = createSafeLogger(elizaLogger);
    
    // Core components
    private restClient?: RestClient;
    private wsClient?: WebSocketClient;
    private messageManager?: MessageManager;
    private channelManager?: ChannelManager;
    private errorHandler?: ErrorHandler;
    
    // Service state
    private botUser?: any;
    private team?: any;
    private isInitializing = false;
    private healthCheckInterval?: NodeJS.Timeout;
    private readonly HEALTH_CHECK_INTERVAL = 60000; // 1 minute

    constructor(runtime?: IAgentRuntime) {
        super(runtime);
    }

    static async start(runtime: IAgentRuntime): Promise<MattermostService> {
        const safeLogger = createSafeLogger(elizaLogger);
        safeLogger.info('*** STARTING MATTERMOST SERVICE ***');
        
        const service = new MattermostService(runtime);
        
        try {
            // Initialize error handler first
            service.errorHandler = new ErrorHandler(runtime);
            
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
            
            // Start health monitoring
            service.startHealthMonitoring();
            
            service.isConnected = true;
            safeLogger.info('*** MATTERMOST SERVICE STARTED SUCCESSFULLY ***');
            safeLogger.info('🚀 Mattermost service is now ready for real-time interactions!');
            safeLogger.info(`🤖 Bot user: ${service.botUser?.username}`);
            safeLogger.info(`🏢 Team: ${service.team?.name}`);
            safeLogger.info('📡 WebSocket connected, MessageManager active');
            
            return service;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown configuration error';
            
            if (service.errorHandler) {
                service.errorHandler.handleError(
                    error instanceof Error ? error : new Error(errorMessage),
                    {
                        severity: ErrorSeverity.HIGH,
                        source: 'MattermostService.start',
                        code: 'SERVICE_STARTUP_FAILED',
                        context: { phase: 'initialization' }
                    }
                );
            }
            
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
            } else if (errorMessage.includes('WebSocket')) {
                safeLogger.error('💡 WebSocket connection failed - check network connectivity and server status');
            }
            
            // Cleanup on failure
            await service.cleanup();
            throw error;
        }
    }

    /**
     * Initialize all service components with proper error handling
     */
    private async initializeComponents(): Promise<void> {
        if (!this.mattermostConfig || !this.errorHandler) {
            throw new Error('Configuration or ErrorHandler not available');
        }

        if (this.isInitializing) {
            this.safeLogger.warn('Components already initializing');
            return;
        }

        this.isInitializing = true;

        try {
            this.safeLogger.info('Initializing Mattermost service components...');
            
            // Initialize REST API client
            this.safeLogger.info('📡 Initializing REST client...');
            this.restClient = new RestClient(this.mattermostConfig);
            await this.restClient.initialize();
            
            // Get bot and team information
            this.botUser = await this.restClient.getBotUser();
            this.team = await this.restClient.getTeam();
            
            this.safeLogger.info('✅ REST client initialized successfully', {
                botId: this.botUser.id,
                botUsername: this.botUser.username,
                teamId: this.team.id,
                teamName: this.team.name
            });

            // Initialize WebSocket client
            this.safeLogger.info('🔌 Initializing WebSocket client...');
            this.wsClient = new WebSocketClient(this.mattermostConfig, this.runtime!);
            
            // Set up WebSocket error handling
            this.wsClient.on('reconnection_failed', (data) => {
                this.errorHandler!.handleError(
                    new Error(`WebSocket reconnection failed after ${data.attempts} attempts`),
                    {
                        severity: ErrorSeverity.HIGH,
                        source: 'WebSocketClient.reconnection',
                        code: 'WEBSOCKET_RECONNECTION_FAILED',
                        context: data
                    }
                );
            });

            this.wsClient.on('reconnection_success', () => {
                this.safeLogger.info('🔄 WebSocket reconnected successfully');
            });

            // Connect WebSocket
            await this.wsClient.connect();
            this.safeLogger.info('✅ WebSocket client connected and authenticated');

            // Initialize Channel Manager
            this.safeLogger.info('📁 Initializing Channel Manager...');
            this.channelManager = new ChannelManager(this.restClient, this.runtime!);
            await this.channelManager.initialize();
            this.safeLogger.info('✅ Channel Manager initialized successfully');

            // Initialize Message Manager (depends on ChannelManager)
            this.safeLogger.info('💬 Initializing Message Manager...');
            this.messageManager = new MessageManager(
                this.mattermostConfig,
                this.runtime!,
                this.wsClient,
                this.restClient
            );
            
            await this.messageManager.initialize();
            this.safeLogger.info('✅ Message Manager initialized successfully');
            
            this.safeLogger.info('🎉 All components initialized successfully');
            
        } catch (error) {
            this.errorHandler.handleError(
                error instanceof Error ? error : new Error('Component initialization failed'),
                {
                    severity: ErrorSeverity.HIGH,
                    source: 'MattermostService.initializeComponents',
                    code: 'COMPONENT_INIT_FAILED'
                }
            );
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    /**
     * Start periodic health monitoring
     */
    private startHealthMonitoring(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(async () => {
            try {
                const health = await this.getHealth();
                this.errorHandler?.reportHealth(health);
            } catch (error) {
                this.errorHandler?.handleError(
                    error instanceof Error ? error : new Error('Health check failed'),
                    {
                        severity: ErrorSeverity.LOW,
                        source: 'MattermostService.healthCheck',
                        code: 'HEALTH_CHECK_FAILED'
                    }
                );
            }
        }, this.HEALTH_CHECK_INTERVAL);

        this.safeLogger.info('🏥 Health monitoring started');
    }

    /**
     * Get comprehensive service health status
     */
    async getHealth(): Promise<ServiceHealth> {
        const now = Date.now();
        const wsConnected = this.wsClient?.isConnected() ?? false;
        let apiAvailable = false;

        // Test API availability
        try {
            if (this.restClient?.isReady) {
                await this.restClient.testConnection();
                apiAvailable = true;
            }
        } catch (error) {
            // API not available
        }

        const messageManagerReady = this.messageManager?.isReady() ?? false;
        const recentErrors = this.errorHandler?.getRecentErrors(5) ?? [];
        const uptime = this.errorHandler?.getUptime() ?? 0;
        const errorCounts = this.errorHandler?.getErrorCounts() ?? { low: 0, medium: 0, high: 0 };

        // Determine overall status
        let status: 'healthy' | 'degraded' | 'unhealthy';
        if (wsConnected && apiAvailable && messageManagerReady) {
            status = 'healthy';
        } else if (apiAvailable || wsConnected) {
            status = 'degraded';
        } else {
            status = 'unhealthy';
        }

        return {
            status,
            lastCheck: now,
            details: {
                wsConnected,
                apiAvailable,
                messageManagerReady,
                errors: recentErrors,
                uptime,
                errorCounts,
            },
        };
    }

    /**
     * Send a message with error handling and resilience
     */
    async sendMessage(channelId: string, content: string, options?: {
        rootId?: string;
        fileIds?: string[];
    }): Promise<any> {
        if (!this.isReady()) {
            const error = new Error('Service not ready');
            this.errorHandler?.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                source: 'MattermostService.sendMessage',
                code: 'SERVICE_NOT_READY',
                context: { channelId }
            });
            throw error;
        }
        
        if (!this.restClient) {
            const error = new Error('REST client not initialized');
            this.errorHandler?.handleError(error, {
                severity: ErrorSeverity.HIGH,
                source: 'MattermostService.sendMessage',
                code: 'REST_CLIENT_NOT_INITIALIZED',
                context: { channelId }
            });
            throw error;
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
            this.errorHandler?.handleError(
                error instanceof Error ? error : new Error('Message send failed'),
                {
                    severity: ErrorSeverity.MEDIUM,
                    source: 'MattermostService.sendMessage',
                    code: 'MESSAGE_SEND_FAILED',
                    context: { channelId, contentLength: content.length }
                }
            );
            throw error;
        }
    }

    /**
     * Join a channel with error handling
     */
    async joinChannel(channelName: string): Promise<any> {
        if (!this.restClient) {
            const error = new Error('REST client not initialized');
            this.errorHandler?.handleError(error, {
                severity: ErrorSeverity.HIGH,
                source: 'MattermostService.joinChannel',
                code: 'REST_CLIENT_NOT_INITIALIZED'
            });
            throw error;
        }

        try {
            const channel = await this.restClient.getChannelByName(this.team!.id, channelName);
            await this.restClient.joinChannel(channel.id);
            
            // Send a greeting message
            await this.sendMessage(channel.id, `Hello everyone! 👋 I'm ${this.botUser?.username}, your new AI assistant. Type "help" to see what I can do!`);
            
            this.safeLogger.info(`✅ Successfully joined channel: ${channelName}`, {
                channelId: channel.id
            });
            
            return channel;
        } catch (error) {
            this.errorHandler?.handleError(
                error instanceof Error ? error : new Error('Channel join failed'),
                {
                    severity: ErrorSeverity.MEDIUM,
                    source: 'MattermostService.joinChannel',
                    code: 'CHANNEL_JOIN_FAILED',
                    context: { channelName }
                }
            );
            throw error;
        }
    }

    /**
     * Get all available channels with error handling
     */
    async getChannels(): Promise<any[]> {
        if (!this.restClient) {
            const error = new Error('REST client not initialized');
            this.errorHandler?.handleError(error, {
                severity: ErrorSeverity.MEDIUM,
                source: 'MattermostService.getChannels',
                code: 'REST_CLIENT_NOT_INITIALIZED'
            });
            throw error;
        }

        try {
            return await this.restClient.getChannelsForTeam();
        } catch (error) {
            this.errorHandler?.handleError(
                error instanceof Error ? error : new Error('Get channels failed'),
                {
                    severity: ErrorSeverity.LOW,
                    source: 'MattermostService.getChannels',
                    code: 'GET_CHANNELS_FAILED'
                }
            );
            throw error;
        }
    }

    /**
     * Get service configuration
     */
    getConfiguration(): MattermostConfig {
        if (!this.mattermostConfig) {
            throw new Error('Service not initialized');
        }
        return this.mattermostConfig;
    }

    /**
     * Get authentication token
     */
    private getToken(): string {
        try {
            return getMattermostToken();
        } catch (error) {
            this.errorHandler?.handleError(
                error instanceof Error ? error : new Error('Token retrieval failed'),
                {
                    severity: ErrorSeverity.HIGH,
                    source: 'MattermostService.getToken',
                    code: 'TOKEN_RETRIEVAL_FAILED'
                }
            );
            throw new Error('Authentication token not available');
        }
    }

    /**
     * Check if service is ready for operations
     */
    isReady(): boolean {
        return this.isConnected && 
               !!this.mattermostConfig && 
               isConfigLoaded() && 
               !!this.restClient && 
               !!this.wsClient?.isConnected() &&
               !!this.messageManager?.isReady() &&
               !!this.channelManager?.initialized &&
               !!this.botUser && 
               !!this.team;
    }

    /**
     * Get error handler instance for external use
     */
    getErrorHandler(): ErrorHandler | undefined {
        return this.errorHandler;
    }

    /**
     * Get message manager instance for external use
     */
    getMessageManager(): MessageManager | undefined {
        return this.messageManager;
    }

    /**
     * Get WebSocket client instance for external use  
     */
    getWebSocketClient(): WebSocketClient | undefined {
        return this.wsClient;
    }

    /**
     * Get REST client instance for external use
     */
    getRestClient(): RestClient | undefined {
        return this.restClient;
    }

    /**
     * Get Channel manager instance for external use
     */
    getChannelManager(): ChannelManager | undefined {
        return this.channelManager;
    }

    /**
     * Cleanup and stop the service
     */
    private async cleanup(): Promise<void> {
        this.safeLogger.info('🧹 Cleaning up service components...');

        // Stop health monitoring
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = undefined;
        }

        // Cleanup message manager
        if (this.messageManager) {
            try {
                await this.messageManager.cleanup();
            } catch (error) {
                this.safeLogger.warn('Error cleaning up message manager:', error);
            }
        }

        // Cleanup channel manager
        if (this.channelManager) {
            try {
                await this.channelManager.cleanup();
            } catch (error) {
                this.safeLogger.warn('Error cleaning up channel manager:', error);
            }
        }

        // Disconnect WebSocket
        if (this.wsClient) {
            try {
                await this.wsClient.disconnect();
            } catch (error) {
                this.safeLogger.warn('Error disconnecting WebSocket:', error);
            }
        }

        // Clear references
        this.restClient = undefined;
        this.wsClient = undefined;
        this.messageManager = undefined;
        this.channelManager = undefined;
        this.botUser = undefined;
        this.team = undefined;
        this.isConnected = false;
    }

    /**
     * Stop the service completely
     */
    async stop(): Promise<void> {
        this.safeLogger.info('*** STOPPING MATTERMOST SERVICE ***');
        
        try {
            await this.cleanup();
            this.safeLogger.info('*** MATTERMOST SERVICE STOPPED ***');
        } catch (error) {
            this.errorHandler?.handleError(
                error instanceof Error ? error : new Error('Service stop failed'),
                {
                    severity: ErrorSeverity.MEDIUM,
                    source: 'MattermostService.stop',
                    code: 'SERVICE_STOP_FAILED'
                }
            );
            this.safeLogger.error('Failed to stop Mattermost service:', error);
            throw error;
        }
    }
}

const mattermostPlugin = {
    name: "mattermost",
    description: "Mattermost platform integration service with real-time messaging and resilience",
    services: [MattermostService]
};

export default mattermostPlugin;
