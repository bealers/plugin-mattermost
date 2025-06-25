#!/usr/bin/env npx tsx

import { loadConfig } from '../../src/config';
import { WebSocketClient } from '../../src/clients/websocket.client';
import { elizaLogger } from '@elizaos/core';

async function testWebSocketEvents() {
  console.log('🚀 Testing Enhanced WebSocket Event System...\n');

  try {
    // Load configuration
    const config = loadConfig();
    console.log('✅ Configuration loaded');

    // Create mock runtime
    const mockRuntime = {
      character: { name: 'TestBot' },
      logger: elizaLogger,
    };

    // Create WebSocket client
    const wsClient = new WebSocketClient(config, mockRuntime);
    console.log('✅ WebSocket client created');

    // Set up various event listeners to demonstrate the enhanced system

    // 1. Specific event listener
    wsClient.on('posted', (data) => {
      console.log('📝 New message posted:', {
        channelId: data.channel_id,
        userId: data.user_id,
        message: data.post?.message?.substring(0, 50) + '...'
      });
    });

    // 2. Authentication event listener
    wsClient.on('authenticated', (data) => {
      console.log('🔐 WebSocket authenticated successfully!');
    });

    // 3. Wildcard listener to catch all events
    wsClient.on('*', (data, eventInfo) => {
      if (eventInfo?.event !== 'hello' && eventInfo?.event !== 'authenticated') {
        console.log('🌟 Wildcard caught event:', {
          event: eventInfo?.event,
          timestamp: new Date(eventInfo?.timestamp || Date.now()).toISOString(),
          hasData: !!data
        });
      }
    });

    // 4. One-time listener for connection
    wsClient.once('hello', (data) => {
      console.log('👋 One-time hello event received - this will only fire once');
    });

    // 5. User typing events
    wsClient.on('typing', (data) => {
      console.log('⌨️  User typing in channel:', data.channel_id);
    });

    // 6. Channel viewed events
    wsClient.on('channel_viewed', (data) => {
      console.log('👁️  Channel viewed:', data.channel_id);
    });

    // 7. Status change events
    wsClient.on('status_change', (data) => {
      console.log('🔄 User status changed:', {
        userId: data.user_id,
        status: data.status
      });
    });

    console.log('✅ Event listeners registered:');
    console.log(`   - Event names: ${wsClient.eventNames().join(', ')}`);
    console.log(`   - Total listeners: ${wsClient.eventNames().reduce((sum, event) => sum + wsClient.listenerCount(event), 0)}`);
    console.log(`   - Wildcard listeners: ${wsClient.listenerCount('*')}`);
    console.log(`   - Posted event listeners: ${wsClient.listenerCount('posted')}`);

    // Connect to WebSocket
    console.log('\n🔌 Connecting to WebSocket...');
    await wsClient.connect();
    console.log('✅ Connected to WebSocket');

    // Keep the connection alive and listen for events
    console.log('\n👂 Listening for events... (Press Ctrl+C to exit)');
    console.log('💡 Try posting a message in the Mattermost channel to see events in action!');

    // Set up graceful shutdown
    const shutdown = async () => {
      console.log('\n🛑 Shutting down...');
      
      // Demonstrate event listener removal
      console.log('🧹 Cleaning up event listeners...');
      wsClient.removeAllListeners();
      console.log(`   - Remaining listeners: ${wsClient.eventNames().length}`);
      
      await wsClient.disconnect();
      console.log('✅ WebSocket disconnected');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep the process alive
    setInterval(() => {
      // Emit a heartbeat to show we're still listening
      const now = new Date().toISOString();
      console.log(`💓 Heartbeat: ${now} - Listening for events...`);
    }, 30000); // Every 30 seconds

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the test
testWebSocketEvents().catch(console.error); 