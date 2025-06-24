import MattermostClient from '@mattermost/client';
const { Client4 } = MattermostClient;
import WebSocket from 'ws';
import { IAgentRuntime, elizaLogger } from '@elizaos/core';
import { MattermostConfig } from '../config';
import { createSafeLogger } from '../config/credentials';

/**
 * Represents a WebSocket message from Mattermost
 */
interface WebSocketMessage {
  event: string;
  data: any;
  broadcast: {
    omit_users: null;
    user_id: string;
    channel_id: string;
    team_id: string;
  };
  seq: number;
}

/**
 * Authentication message structure for WebSocket
 */
interface AuthMessage {
  seq: number;
  action: string;
  data: {
    token: string;
  };
}

/**
 * WebSocket client for real-time communication with Mattermost
 */
export class WebSocketClient {
  private config: MattermostConfig;
  private runtime: IAgentRuntime;
  private client: Client4;
  private ws: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private eventListeners: Map<string, Set<(data: any) => void>> = new Map();
  private isAuthenticated: boolean = false;
  private connectionPromise: Promise<void> | null = null;
  private logger = createSafeLogger(elizaLogger);

  constructor(config: MattermostConfig, runtime: IAgentRuntime) {
    this.config = config;
    this.runtime = runtime;
    this.client = new Client4();
    this.client.setUrl(config.env.MATTERMOST_URL);
    this.client.setToken(config.env.MATTERMOST_TOKEN);
  }

  /**
   * Connect to the Mattermost WebSocket server
   */
  async connect(): Promise<void> {
    // If already connecting, return the existing promise
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = this._performConnect();
    
    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  /**
   * Internal connection logic
   */
  private async _performConnect(): Promise<void> {
    try {
      // Get WebSocket URL from Client4
      const wsUrl = this.client.getWebSocketUrl();
      this.logger.info(`Connecting to WebSocket: ${wsUrl}`);

      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', this.handleOpen.bind(this));
      this.ws.on('message', this.handleMessage.bind(this));
      this.ws.on('error', this.handleError.bind(this));
      this.ws.on('close', this.handleClose.bind(this));
      
      // Wait for connection to be established and authenticated
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000); // 10 second timeout
        
        // Listen for successful authentication
        const authHandler = () => {
          clearTimeout(timeout);
          this.off('authenticated', authHandler);
          resolve();
        };
        this.on('authenticated', authHandler);
        
        // Handle connection errors
        if (this.ws) {
          this.ws.once('error', (error) => {
            clearTimeout(timeout);
            this.off('authenticated', authHandler);
            reject(error);
          });
        }
      });
      
      this.reconnectAttempts = 0;
      this.logger.info('WebSocket connected and authenticated successfully');
    } catch (error) {
      this.logger.error(`WebSocket connection failed: ${error.message}`);
      this.attemptReconnect();
      throw error;
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting WebSocket client');
    
    // Clear reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    // Reset authentication state
    this.isAuthenticated = false;
    
    // Close WebSocket connection
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
    
    // Clear event listeners
    this.removeAllListeners();
    
    this.logger.info('WebSocket client disconnected');
  }

  /**
   * Check if the client is connected and authenticated
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.isAuthenticated;
  }

  /**
   * Register an event listener
   * @param event - Event name or '*' for all events
   * @param callback - Function to call when event is emitted
   */
  on(event: string, callback: (data: any) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(callback);
    
    this.logger.debug(`Registered listener for event: ${event}`, {
      event,
      totalListeners: this.eventListeners.get(event)!.size
    });
  }

  /**
   * Remove an event listener
   * @param event - Event name to remove listener from
   * @param callback - Specific callback to remove
   */
  off(event: string, callback: (data: any) => void): void {
    if (this.eventListeners.has(event)) {
      const listeners = this.eventListeners.get(event)!;
      listeners.delete(callback);
      
      // Clean up empty listener sets
      if (listeners.size === 0) {
        this.eventListeners.delete(event);
      }
      
      this.logger.debug(`Removed listener for event: ${event}`, {
        event,
        remainingListeners: listeners.size
      });
    }
  }

  /**
   * Register a one-time event listener that automatically removes itself after first emission
   * @param event - Event name to listen for
   * @param callback - Function to call when event is emitted
   */
  once(event: string, callback: (data: any) => void): void {
    const onceCallback = (data: any) => {
      this.off(event, onceCallback);
      callback(data);
    };
    this.on(event, onceCallback);
  }

  /**
   * Remove all listeners for a specific event, or all listeners if no event specified
   * @param event - Optional event name. If omitted, removes all listeners
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.eventListeners.delete(event);
      this.logger.debug(`Removed all listeners for event: ${event}`);
    } else {
      const totalEvents = this.eventListeners.size;
      this.eventListeners.clear();
      this.logger.debug(`Removed all event listeners`, { totalEvents });
    }
  }

  /**
   * Get the number of listeners for a specific event
   * @param event - Event name to check
   * @returns Number of listeners registered for the event
   */
  listenerCount(event: string): number {
    return this.eventListeners.has(event) ? this.eventListeners.get(event)!.size : 0;
  }

  /**
   * Get all registered event names
   * @returns Array of event names that have listeners
   */
  eventNames(): string[] {
    return Array.from(this.eventListeners.keys());
  }

  /**
   * Handle WebSocket connection open
   */
  private handleOpen(): void {
    this.logger.info('WebSocket connection opened');
    
    // Send authentication challenge
    if (this.ws) {
      const authMessage: AuthMessage = {
        seq: 1,
        action: 'authentication_challenge',
        data: { token: this.config.env.MATTERMOST_TOKEN },
      };
      
      this.logger.debug('Sending authentication challenge');
      this.ws.send(JSON.stringify(authMessage));
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      
      this.logger.debug(`Received WebSocket event: ${message.event}`, {
        event: message.event,
        seq: message.seq
      });
      
      // Handle authentication response
      if (message.event === 'hello') {
        this.isAuthenticated = true;
        this.logger.info('WebSocket authenticated successfully');
        this.emitEvent('authenticated', message.data, { originalMessage: message });
        return;
      }
      
      // Emit event with full message context
      this.emitEvent(message.event, message.data, { 
        originalMessage: message,
        broadcast: message.broadcast,
        seq: message.seq 
      });
      
    } catch (error) {
      this.logger.error(`Error handling WebSocket message: ${error.message}`, {
        error: error.message,
        data: data.toString().substring(0, 200) // Log first 200 chars for debugging
      });
    }
  }

  /**
   * Handle WebSocket errors
   */
  private handleError(error: Error): void {
    this.logger.error(`WebSocket error: ${error.message}`, {
      error: error.message,
      reconnectAttempts: this.reconnectAttempts
    });
  }

  /**
   * Handle WebSocket connection close
   */
  private handleClose(code: number, reason: Buffer): void {
    const reasonString = reason.toString();
    this.isAuthenticated = false;
    
    this.logger.warn(`WebSocket closed: ${code} ${reasonString}`, {
      code,
      reason: reasonString,
      reconnectAttempts: this.reconnectAttempts
    });
    
    // Don't attempt reconnection if it was a clean close (code 1000)
    if (code !== 1000) {
      this.attemptReconnect();
    }
  }

  /**
   * Emit an event to all registered listeners
   * @param event - Event name to emit
   * @param data - Data to pass to listeners
   * @param metadata - Optional metadata about the event
   */
  private emitEvent(event: string, data: any, metadata?: any): void {
    const eventInfo = {
      event,
      data,
      metadata,
      timestamp: Date.now()
    };

    // Track emission for debugging
    this.logger.debug(`Emitting event: ${event}`, {
      event,
      listenerCount: this.listenerCount(event),
      wildcardListenerCount: this.listenerCount('*'),
      hasData: !!data
    });

    // Emit to specific event listeners
    this._emitToListeners(event, eventInfo);
    
    // Emit to wildcard listeners (unless this is already a wildcard emission)
    if (event !== '*') {
      this._emitToListeners('*', eventInfo);
    }
  }

  /**
   * Internal method to emit to a specific set of listeners
   * @param event - Event name
   * @param eventInfo - Complete event information
   */
  private _emitToListeners(event: string, eventInfo: any): void {
    if (this.eventListeners.has(event)) {
      const listeners = this.eventListeners.get(event)!;
      let successCount = 0;
      let errorCount = 0;

      for (const listener of listeners) {
        try {
          listener(eventInfo.data, eventInfo);
          successCount++;
        } catch (error) {
          errorCount++;
          this.logger.error(`Error in event listener for ${event}: ${error.message}`, {
            event,
            error: error.message,
            listenerIndex: successCount + errorCount
          });
        }
      }

      if (errorCount > 0) {
        this.logger.warn(`Event emission completed with errors`, {
          event,
          successCount,
          errorCount,
          totalListeners: listeners.size
        });
      }
    }
  }

  /**
   * Emit a custom event (for external use)
   * @param event - Event name
   * @param data - Data to emit
   * @param metadata - Optional metadata
   */
  emit(event: string, data: any, metadata?: any): void {
    this.emitEvent(event, data, metadata);
  }

  /**
   * Attempt to reconnect with exponential backoff
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.error(`Maximum reconnection attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    
    this.logger.info(`Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    this.reconnectTimeout = setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        this.logger.error(`Reconnection attempt ${this.reconnectAttempts} failed: ${error.message}`);
        // Error handling and further reconnection attempts are handled in connect()
      }
    }, delay);
  }
} 