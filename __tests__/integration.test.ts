import { describe, expect, it, vi, afterAll, beforeAll, beforeEach } from 'vitest';
import { config } from 'dotenv';
import { RestClient } from '../src/clients/rest.client';
import { loadConfig } from '../src/config';
import { createSafeLogger } from '../src/config/credentials';
import type { MattermostConfig } from '../src/config';

// Load .env file before anything else
config();

/**
 * Integration tests for RestClient against a specified Mattermost server.
 * These tests validate the complete REST API functionality including:
 * - Authentication and connection
 * - Team and user operations
 * - Channel operations
 * - Message posting
 * - Error handling and resilience
 * 
 * NOTE: These tests require a valid Mattermost configuration in .env
 * and will make real API calls to the configured server.
 * 
 * SETUP REQUIREMENTS:
 * 1. Set MATTERMOST_URL, MATTERMOST_TOKEN, MATTERMOST_TEAM in .env
 * 2. Set MATTERMOST_TEST_CHANNEL to a public channel the bot can access
 * 3. Ensure the bot user has permissions to post in the test channel
 * 
 * If MATTERMOST_TEST_CHANNEL is not set, defaults to 'eliza-testing'
 */

describe('RestClient Integration Tests', () => {
  let client: RestClient;
  let mattermostConfig: MattermostConfig;
  let testUserId: string;
  let testTeamId: string;
  let testChannelId: string | null = null;
  let testChannelName: string;

  beforeAll(async () => {
    try {
      console.log('✅ Configuration loaded successfully');
      mattermostConfig = loadConfig();
      testChannelName = mattermostConfig.env.MATTERMOST_TEST_CHANNEL;
      
      const logger = createSafeLogger(mattermostConfig);
      client = new RestClient(mattermostConfig);
      
      await client.initialize();
      
      // Get bot user and team info
      const me = await client.getBotUser();
      testUserId = me.id;
      console.log(`✅ Authenticated as: ${me.username} (${me.id})`);
      
      const team = await client.getTeam();
      testTeamId = team.id;
      console.log(`✅ Found team: ${team.display_name} (${team.id})`);
      
      // Try to find test channel
      try {
        const testChannel = await client.getChannelByName(testChannelName);
        testChannelId = testChannel.id;
        console.log(`✅ Found test channel: ${testChannel.display_name || testChannelName} (${testChannel.id})`);
      } catch (error) {
        console.log(`⚠️ Test channel "${testChannelName}" not found - message operations will be skipped`);
        console.log(`💡 To enable full testing, create a public channel named "${testChannelName}" or set MATTERMOST_TEST_CHANNEL in .env`);
      }
      
    } catch (error) {
      console.log('⚠️ Integration tests will be skipped - configuration or connection failed:', error.message);
      console.log('💡 To run integration tests:');
      console.log('   1. Create .env file with MATTERMOST_URL, MATTERMOST_TOKEN, MATTERMOST_TEAM');
      console.log('   2. Optionally set MATTERMOST_TEST_CHANNEL (defaults to "eliza-testing")');
      console.log('   3. Ensure the bot has access to the test channel');
    }
  });

  afterAll(async () => {
    // No disconnect method needed - RestClient doesn't have one
    if (client) {
      console.log('✅ Client tests completed');
    }
  });

  describe('Configuration and Connection', () => {
    it('should load configuration successfully', () => {
      expect(mattermostConfig).toBeDefined();
      expect(mattermostConfig.env.MATTERMOST_URL).toBeTruthy();
      expect(mattermostConfig.env.MATTERMOST_TOKEN).toBeTruthy();
      expect(mattermostConfig.env.MATTERMOST_TEAM).toBeTruthy();
      expect(mattermostConfig.env.MATTERMOST_TEST_CHANNEL).toBeTruthy();
    });

    it('should initialize client successfully', () => {
      expect(client).toBeDefined();
      expect(client.isReady()).toBe(true);
    });
  });

  describe('Authentication and User Operations', () => {
    it('should authenticate and get bot user info', async () => {
      if (!client) return; // Skip if no config
      
      const me = await client.getBotUser();
      expect(me).toBeDefined();
      expect(me.id).toBeTruthy();
      expect(me.username).toBeTruthy();
      expect(me.id).toBe(testUserId);
    });

    it('should get team info', async () => {
      if (!client) return;
      
      const team = await client.getTeam();
      expect(team).toBeDefined();
      expect(team.id).toBeTruthy();
      expect(team.name).toBeTruthy();
      expect(team.id).toBe(testTeamId);
    });

    it('should test connection successfully', async () => {
      if (!client) return;
      
      const connectionTest = await client.testConnection();
      expect(connectionTest.success).toBe(true);
      expect(connectionTest.error).toBeUndefined();
    });
  });

  describe('Channel Operations', () => {
    it('should get channel by name', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping channel test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const channel = await client.getChannelByName(testChannelName);
      expect(channel).toBeDefined();
      expect(channel.id).toBe(testChannelId);
      expect(channel.name).toBe(testChannelName);
      expect(channel.team_id).toBe(testTeamId);
    });

    it('should get channel by ID', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping channel test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const channel = await client.getChannel(testChannelId);
      expect(channel).toBeDefined();
      expect(channel.id).toBe(testChannelId);
      expect(channel.name).toBe(testChannelName);
    });
  });

  describe('Message Operations', () => {
    let testPostId: string;

    it('should post a message to channel', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping message test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const message = `🧪 Integration Test Message - ${new Date().toISOString()}`;
      const post = await client.createPost(testChannelId, message);
      
      expect(post).toBeDefined();
      expect(post.id).toBeTruthy();
      expect(post.message).toBe(message);
      expect(post.channel_id).toBe(testChannelId);
      expect(post.user_id).toBe(testUserId);
      
      testPostId = post.id;
    });

    it('should retrieve the posted message', async () => {
      if (!client || !testPostId) {
        console.log(`⚠️ Skipping message test - no test post available`);
        return;
      }
      
      const post = await client.getPost(testPostId);
      expect(post).toBeDefined();
      expect(post.id).toBe(testPostId);
      expect(post.message).toContain('Integration Test Message');
    });

    it('should update the posted message', async () => {
      if (!client || !testPostId) {
        console.log(`⚠️ Skipping message test - no test post available`);
        return;
      }
      
      const updatedMessage = `🧪 UPDATED Integration Test Message - ${new Date().toISOString()}`;
      const updatedPost = await client.updatePost(testPostId, updatedMessage);
      
      expect(updatedPost).toBeDefined();
      expect(updatedPost.message).toBe(updatedMessage);
      expect(updatedPost.edit_at).toBeGreaterThan(0);
    });

    it('should get channel posts', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping message test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const posts = await client.getPostsForChannel(testChannelId, { perPage: 10 });
      expect(posts).toBeDefined();
      expect(posts.posts).toBeDefined();
      expect(Object.keys(posts.posts).length).toBeGreaterThan(0);
      
      // Our test post should be in there
      if (testPostId) {
        expect(posts.posts[testPostId]).toBeDefined();
      }
    });
  });

  describe('Error Handling and Resilience', () => {
    it('should handle invalid channel gracefully', async () => {
      if (!client) return;
      
      await expect(client.getChannel('invalid-channel-id'))
        .rejects.toThrow();
    });

    it('should handle invalid post gracefully', async () => {
      if (!client) return;
      
      await expect(client.getPost('invalid-post-id'))
        .rejects.toThrow();
    });

    it('should handle posting to invalid channel', async () => {
      if (!client) return;
      
      await expect(client.createPost('invalid-channel-id', 'This should fail'))
        .rejects.toThrow();
    });
  });

  describe('Performance and Load Testing', () => {
    it('should handle multiple concurrent requests', async () => {
      if (!client || !testChannelId) {
        console.log(`⚠️ Skipping performance test - test channel "${testChannelName}" not available`);
        return;
      }
      
      const promises = Array.from({ length: 5 }, (_, i) => 
        client.createPost(testChannelId, `🚀 Concurrent Test Message ${i + 1} - ${new Date().toISOString()}`)
      );
      
      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
      results.forEach((post, i) => {
        expect(post.message).toContain(`Concurrent Test Message ${i + 1}`);
      });
    });

    it('should maintain connection after multiple operations', async () => {
      if (!client) return;
      
      // Perform multiple operations
      const me = await client.getBotUser();
      const team = await client.getTeam();
      
      if (testChannelId) {
        const channel = await client.getChannel(testChannelId);
        const posts = await client.getPostsForChannel(testChannelId, { perPage: 5 });
      }
      
      // Client should still be ready
      expect(client.isReady()).toBe(true);
      expect(me.id).toBeTruthy();
      expect(team.id).toBeTruthy();
    });
  });
});
