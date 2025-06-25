import { vi, MockedFunction } from 'vitest';
import { IAgentRuntime, ModelType } from '@elizaos/core';
import { MessageManager } from '../../../src/managers/message.manager';
import { WebSocketClient } from '../../../src/clients/websocket.client';
import { RestClient } from '../../../src/clients/rest.client';
import { MattermostConfig } from '../../../src/config';
import { createMockConfig, createMockRuntime, createMockWebSocketClient, createMockRestClient } from '../../utils/test-utils';

// Mock ElizaOS imports
vi.mock('@elizaos/core', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  };
  
  return {
    elizaLogger: mockLogger,
    ModelType: {
      TEXT_LARGE: 'TEXT_LARGE'
    },
    createSafeLogger: vi.fn(() => mockLogger)
  };
});

export interface MessageManagerTestSetup {
  messageManager: MessageManager;
  mockConfig: MattermostConfig;
  mockRuntime: IAgentRuntime;
  mockWsClient: WebSocketClient;
  mockRestClient: RestClient;
  useModelMock: MockedFunction<any>;
  composeStateMock: any;
}

export function createMessageManagerTestSetup(): MessageManagerTestSetup {
  // Create mock dependencies
  const mockConfig = createMockConfig();
  const mockRuntime = createMockRuntime();
  const mockWsClient = createMockWebSocketClient() as any;
  const mockRestClient = createMockRestClient() as any;

  // Setup useModel mock
  const useModelMock = vi.fn().mockResolvedValue('Mock AI response');
  mockRuntime.useModel = useModelMock;

  // Setup mock runtime with composeState method
  const composeStateMock = vi.fn().mockResolvedValue('Mocked AI response');
  mockRuntime.composeState = composeStateMock;

  // Create MessageManager instance
  const messageManager = new MessageManager(
    mockConfig,
    mockRuntime,
    mockWsClient,
    mockRestClient
  );

  return {
    messageManager,
    mockConfig,
    mockRuntime,
    mockWsClient,
    mockRestClient,
    useModelMock,
    composeStateMock
  };
}

// Helper function to process message and wait for async completion
export const processMessageAndWait = async (mockWsClient: WebSocketClient, messageData: any) => {
  const postedHandler = vi.mocked(mockWsClient.on).mock.calls
    .find(call => call[0] === 'posted')?.[1];
  expect(postedHandler).toBeDefined();
  
  await postedHandler!(messageData);
  // Wait for async processing via setImmediate
  await new Promise(resolve => setImmediate(resolve));
};

// Create mock WebSocket event with common defaults
export function createMockWebSocketEvent(options: {
  channelType?: string;
  postId?: string;
  userId?: string;
  message?: string;
  channelId?: string;
  channelName?: string;
  rootId?: string;
  mentions?: string;
  type?: string;
} = {}) {
  const {
    channelType = 'D',
    postId = 'msg-1',
    userId = 'user-123',
    message = 'Hello bot!',
    channelId = 'channel-123',
    channelName = 'direct-channel',
    rootId = '',
    mentions = '',
    type = ''
  } = options;

  return {
    channel_display_name: channelType === 'D' ? 'Direct Message' : 'General',
    channel_name: channelName,
    channel_type: channelType,
    post: JSON.stringify({
      id: postId,
      user_id: userId,
      channel_id: channelId,
      message: message,
      create_at: Date.now(),
      update_at: Date.now(),
      type: type,
      props: {},
      hashtags: '',
      pending_post_id: '',
      reply_count: 0,
      last_reply_at: 0,
      participants: null,
      is_following: false,
      channel_mentions: mentions ? [mentions] : [],
      root_id: rootId
    }),
    sender_name: 'Test User',
    team_id: 'team-123'
  };
}

// Common test data
export const testData = {
  directMessage: () => createMockWebSocketEvent({
    channelType: 'D',
    channelName: 'user__bot',
    message: 'Hello bot!'
  }),
  
  mentionMessage: () => createMockWebSocketEvent({
    channelType: 'O',
    channelName: 'general',
    message: '@bot help me',
    mentions: '@bot'
  }),
  
  threadReply: (rootId: string) => createMockWebSocketEvent({
    channelType: 'O',
    channelName: 'general',
    message: 'This is a thread reply',
    rootId: rootId
  }),
  
  botMessage: () => createMockWebSocketEvent({
    userId: 'mock-bot-user-id',
    message: 'Bot response'
  })
}; 