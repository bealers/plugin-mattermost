#!/usr/bin/env node

import 'dotenv/config';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { loadConfig } from '../../src/config';
import { elizaLogger } from '@elizaos/core';

/**
 * Test script to validate WebSocket connection to Mattermost
 */
async function testWebSocketConnection() {
  console.log('Testing WebSocket Connection to Mattermost...\n');

  try {
    // Load configuration
    console.log('Loading Mattermost configuration...');
    const config = loadConfig();
    console.log('Configuration loaded successfully');
    console.log(`   Server: ${config.env.MATTERMOST_URL}`);
    console.log(`   Bot: ${config.env.MATTERMOST_BOT_USERNAME}\n`);

    // Create mock runtime (minimal for testing)
    const mockRuntime = {
      character: { name: 'TestBot' },
      logger: elizaLogger
    } as any;

    // Create WebSocket client
    console.log('Creating WebSocket client...');
    const wsClient = new WebSocketClient(config, mockRuntime);

    // Set up event listeners for testing
    wsClient.on('hello', (data) => {
      console.log('👋 Received hello event:', data);
    });

    wsClient.on('posted', (data) => {
      console.log('📝 Received posted event:', data);
    });

    wsClient.on('user_typing', (data) => {
      console.log('Received typing event:', data);
    });

    // Connect to WebSocket
    console.log('Connecting to WebSocket...');
    await wsClient.connect();
    console.log('WebSocket connected successfully!\n');

    // Keep connection alive for testing
    console.log('Keeping connection alive for 30 seconds...');
    console.log('   Try posting a message in Mattermost to see real-time events\n');

    // Wait for 30 seconds to observe events
    await new Promise(resolve => setTimeout(resolve, 30000));

    // Disconnect
    console.log('Disconnecting WebSocket...');
    await wsClient.disconnect();
    console.log('WebSocket disconnected successfully');

  } catch (error) {
    console.error('WebSocket test failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the test
testWebSocketConnection()
  .then(() => {
    console.log('\nWebSocket test completed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 WebSocket test failed:', error);
    process.exit(1);
  }); 