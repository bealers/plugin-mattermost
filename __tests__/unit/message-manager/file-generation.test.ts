import { describe, it, expect, beforeEach, afterEach, vi, type MockedFunction } from 'vitest';
import { MessageManager } from '../../../src/managers/message.manager';
import { WebSocketClient } from '../../../src/clients/websocket.client';
import { RestClient } from '../../../src/clients/rest.client';
import { AttachmentManager } from '../../../src/managers/attachment.manager';
import { IAgentRuntime } from '@elizaos/core';
import { MattermostConfig } from '../../../src/config';

describe('MessageManager - File Generation Commands', () => {
  let messageManager: MessageManager;
  let mockConfig: Partial<MattermostConfig>;
  let mockRuntime: Partial<IAgentRuntime>;
  let mockWsClient: Partial<WebSocketClient>;
  let mockRestClient: Partial<RestClient>;
  let mockAttachmentManager: Partial<AttachmentManager>;
  let mockLogger: any;

  const mockPost = {
    id: 'post123',
    user_id: 'user123',
    channel_id: 'channel123',
    message: '',
    create_at: Date.now(),
    update_at: Date.now(),
    type: '',
    props: {},
    hashtags: '',
    pending_post_id: '',
    reply_count: 0,
    last_reply_at: 0,
    participants: null,
    is_following: false,
    channel_mentions: []
  };

  const mockEventData = {
    channel_display_name: 'Test Channel',
    channel_name: 'test-channel',
    channel_type: 'O',
    post: JSON.stringify(mockPost),
    sender_name: 'Test User',
    team_id: 'team123'
  };

  beforeEach(() => {
    // Setup mocks
    mockLogger = {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    mockConfig = {
      baseUrl: 'https://test.mattermost.com',
      token: 'test-token',
      teamName: 'test-team',
      logLevel: 'info'
    };

    mockRuntime = {
      logger: mockLogger,
      getSetting: vi.fn(),
      databaseAdapter: {
        log: vi.fn()
      } as any
    };

    mockWsClient = {
      isConnected: vi.fn().mockReturnValue(true),
      on: vi.fn(),
      off: vi.fn()
    };

    mockRestClient = {
      getBotUser: vi.fn().mockReturnValue({ id: 'bot123', username: 'testbot' }),
      isReady: true,
      createPost: vi.fn().mockResolvedValue({ id: 'response123' }),
      posts: {
        createPost: vi.fn().mockResolvedValue({ id: 'response123' })
      }
    };

    mockAttachmentManager = {
      generateAndUploadCSV: vi.fn().mockResolvedValue('file123'),
      generateAndUploadMarkdownReport: vi.fn().mockResolvedValue('file124'),
      generateAndUploadJSON: vi.fn().mockResolvedValue('file125'),
      generateAndUploadTextFile: vi.fn().mockResolvedValue('file126')
    };

    messageManager = new MessageManager(
      mockConfig as MattermostConfig,
      mockRuntime as IAgentRuntime,
      mockWsClient as WebSocketClient,
      mockRestClient as RestClient,
      mockAttachmentManager as AttachmentManager
    );

    // Initialize the manager
    (messageManager as any).botUserId = 'bot123';
    (messageManager as any).isInitialized = true;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Command Detection', () => {
    it('should detect !generate commands', async () => {
      const post = { ...mockPost, message: '!generate type:csv title:"Test Report"' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      const spy = vi.spyOn(messageManager as any, 'handleFileGenerationCommand').mockResolvedValue();
      
      await (messageManager as any).routeMessage({
        post,
        eventData,
        shouldProcess: true,
        reason: 'Test',
        isDirectMessage: false,
        isMention: true,
        mentions: ['bot123']
      });

      expect(spy).toHaveBeenCalledWith(post, eventData);
    });

    it('should detect !report commands', async () => {
      const post = { ...mockPost, message: '!report type:markdown title:"Status Report"' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      const spy = vi.spyOn(messageManager as any, 'handleFileGenerationCommand').mockResolvedValue();
      
      await (messageManager as any).routeMessage({
        post,
        eventData,
        shouldProcess: true,
        reason: 'Test',
        isDirectMessage: false,
        isMention: true,
        mentions: ['bot123']
      });

      expect(spy).toHaveBeenCalledWith(post, eventData);
    });

    it('should detect !file commands', async () => {
      const post = { ...mockPost, message: '!file type:json title:"Config File"' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      const spy = vi.spyOn(messageManager as any, 'handleFileGenerationCommand').mockResolvedValue();
      
      await (messageManager as any).routeMessage({
        post,
        eventData,
        shouldProcess: true,
        reason: 'Test',
        isDirectMessage: false,
        isMention: true,
        mentions: ['bot123']
      });

      expect(spy).toHaveBeenCalledWith(post, eventData);
    });

    it('should not trigger file generation for normal messages', async () => {
      const post = { ...mockPost, message: 'This is just a normal message' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      const spy = vi.spyOn(messageManager as any, 'handleFileGenerationCommand');
      const aiSpy = vi.spyOn(messageManager as any, 'generateAIResponse').mockResolvedValue({
        success: true,
        response: 'Test response'
      });
      
      await (messageManager as any).routeMessage({
        post,
        eventData,
        shouldProcess: true,
        reason: 'Test',
        isDirectMessage: false,
        isMention: true,
        mentions: ['bot123']
      });

      expect(spy).not.toHaveBeenCalled();
      expect(aiSpy).toHaveBeenCalled();
    });
  });

  describe('Command Parsing', () => {
    it('should parse file type correctly', () => {
      const result = (messageManager as any).parseFileGenerationCommand('!generate type:csv title:"Test"');
      expect(result.type).toBe('csv');
    });

    it('should parse title with quotes', () => {
      const result = (messageManager as any).parseFileGenerationCommand('!generate title:"My Report"');
      expect(result.title).toBe('My Report');
    });

    it('should parse title without quotes', () => {
      const result = (messageManager as any).parseFileGenerationCommand('!generate title:MyReport');
      expect(result.title).toBe('MyReport');
    });

    it('should detect sample data request', () => {
      const result = (messageManager as any).parseFileGenerationCommand('!generate type:csv sample');
      expect(result.sampleData).toBe(true);
    });

    it('should parse custom content', () => {
      const result = (messageManager as any).parseFileGenerationCommand('!generate content:"Custom content here"');
      expect(result.content).toBe('Custom content here');
    });

    it('should generate proper filename with timestamp', () => {
      const result = (messageManager as any).parseFileGenerationCommand('!generate type:csv title:"Test Report"');
      expect(result.filename).toMatch(/^test-report-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/);
    });

    it('should default to text type', () => {
      const result = (messageManager as any).parseFileGenerationCommand('!generate title:"Test"');
      expect(result.type).toBe('text');
      expect(result.filename).toMatch(/\.txt$/);
    });
  });

  describe('File Generation', () => {
    beforeEach(() => {
      vi.spyOn(messageManager as any, 'parseFileGenerationCommand').mockReturnValue({
        type: 'csv',
        title: 'Test Report',
        filename: 'test-report-2024-01-01T12-00-00.csv',
        sampleData: true
      });
    });

    it('should generate CSV files', async () => {
      const post = { ...mockPost, message: '!generate type:csv sample' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      await (messageManager as any).handleFileGenerationCommand(post, eventData);

      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        post.channel_id,
        '🔄 Processing your file generation request...',
        { rootId: post.id }
      );

      expect(mockAttachmentManager.generateAndUploadCSV).toHaveBeenCalled();
    });

    it('should generate markdown files', async () => {
      vi.spyOn(messageManager as any, 'parseFileGenerationCommand').mockReturnValue({
        type: 'markdown',
        title: 'Test Report',
        filename: 'test-report-2024-01-01T12-00-00.md'
      });

      const post = { ...mockPost, message: '!generate type:markdown' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      await (messageManager as any).handleFileGenerationCommand(post, eventData);

      expect(mockAttachmentManager.generateAndUploadMarkdownReport).toHaveBeenCalled();
    });

    it('should generate JSON files', async () => {
      vi.spyOn(messageManager as any, 'parseFileGenerationCommand').mockReturnValue({
        type: 'json',
        title: 'Test Config',
        filename: 'test-config-2024-01-01T12-00-00.json'
      });

      const post = { ...mockPost, message: '!generate type:json' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      await (messageManager as any).handleFileGenerationCommand(post, eventData);

      expect(mockAttachmentManager.generateAndUploadJSON).toHaveBeenCalled();
    });

    it('should generate text files by default', async () => {
      vi.spyOn(messageManager as any, 'parseFileGenerationCommand').mockReturnValue({
        type: 'text',
        title: 'Test File',
        filename: 'test-file-2024-01-01T12-00-00.txt'
      });

      const post = { ...mockPost, message: '!generate' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      await (messageManager as any).handleFileGenerationCommand(post, eventData);

      expect(mockAttachmentManager.generateAndUploadTextFile).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle file generation errors gracefully', async () => {
      const error = new Error('File generation failed');
      mockAttachmentManager.generateAndUploadCSV = vi.fn().mockRejectedValue(error);

      const post = { ...mockPost, message: '!generate type:csv' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      vi.spyOn(messageManager as any, 'parseFileGenerationCommand').mockReturnValue({
        type: 'csv',
        title: 'Test',
        filename: 'test.csv'
      });

      await (messageManager as any).routeMessage({
        post,
        eventData,
        shouldProcess: true,
        reason: 'Test',
        isDirectMessage: false,
        isMention: true,
        mentions: ['bot123']
      });

      // Should send the processing message
      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        post.channel_id,
        '🔄 Processing your file generation request...',
        { rootId: post.id }
      );

      // Should attempt the file generation which fails
      expect(mockAttachmentManager.generateAndUploadCSV).toHaveBeenCalled();
    });

    it('should log errors properly', async () => {
      const error = new Error('Test error');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockAttachmentManager.generateAndUploadCSV = vi.fn().mockRejectedValue(error);

      const post = { ...mockPost, message: '!generate type:csv' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      vi.spyOn(messageManager as any, 'parseFileGenerationCommand').mockReturnValue({
        type: 'csv',
        title: 'Test',
        filename: 'test.csv'
      });

      await (messageManager as any).routeMessage({
        post,
        eventData,
        shouldProcess: true,
        reason: 'Test',
        isDirectMessage: false,
        isMention: true,
        mentions: ['bot123']
      });

      // Should attempt the file generation
      expect(mockAttachmentManager.generateAndUploadCSV).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Content Generation', () => {
    it('should generate sample markdown content', () => {
      const content = (messageManager as any).generateSampleMarkdownContent('Test Report');
      
      expect(content).toContain('## Introduction');
      expect(content).toContain('Test Report');
      expect(content).toContain('## Features');
      expect(content).toContain('Usage Examples');
      expect(content).toContain('Generated on:');
    });

    it('should generate sample text content', () => {
      const content = (messageManager as any).generateSampleTextContent('Test File');
      
      expect(content).toContain('Test File');
      expect(content).toContain('Generated on:');
      expect(content).toContain('FEATURES:');
      expect(content).toContain('USAGE:');
      expect(content).toContain('END OF FILE');
    });
  });

  describe('Integration', () => {
    it('should skip normal AI processing for file generation commands', async () => {
      const post = { ...mockPost, message: '!generate type:csv' };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      const aiSpy = vi.spyOn(messageManager as any, 'generateAIResponse');
      vi.spyOn(messageManager as any, 'handleFileGenerationCommand').mockResolvedValue();

      await (messageManager as any).routeMessage({
        post,
        eventData,
        shouldProcess: true,
        reason: 'Test',
        isDirectMessage: false,
        isMention: true,
        mentions: ['bot123']
      });

      expect(aiSpy).not.toHaveBeenCalled();
    });

    it('should handle thread replies for file generation', async () => {
      const post = { 
        ...mockPost, 
        message: '!generate type:csv',
        root_id: 'thread123'
      };
      const eventData = { ...mockEventData, post: JSON.stringify(post) };

      await (messageManager as any).handleFileGenerationCommand(post, eventData);

      expect(mockRestClient.createPost).toHaveBeenCalledWith(
        post.channel_id,
        '🔄 Processing your file generation request...',
        { rootId: 'thread123' }
      );
    });
  });
}); 