import { vi } from 'vitest';
import {
  Content,
  Memory,
  ModelType,
  Service,
  State,
  UUID,
  logger,
} from '@elizaos/core';
import { MattermostConfig } from '../../src/config';

/**
 * Creates a mock runtime for testing
 *
 * @param overrides - Optional overrides for the default mock methods and properties
 * @returns A mock runtime for testing
 */
export function createMockRuntime(overrides: Partial<MockRuntime> = {}): MockRuntime {
  // Create base mock runtime with defaults
  const mockRuntime: MockRuntime = {
    // Core properties
    agentId: 'test-agent-id' as UUID,
    character: {
      name: 'Test Character',
      bio: 'This is a test character for testing',
    },
    services: new Map(),

    // Core methods
    getService: vi.fn().mockReturnValue(null),
    registerService: vi.fn(),
    getSetting: vi.fn().mockReturnValue(null),

    // Model methods
    useModel: vi.fn().mockImplementation((modelType) => {
      if (modelType === ModelType.TEXT_SMALL) {
        return Promise.resolve('Never gonna give you up, never gonna let you down');
      } else if (modelType === ModelType.TEXT_LARGE) {
        return Promise.resolve('Never gonna make you cry, never gonna say goodbye');
      } else if (modelType === ModelType.OBJECT_LARGE) {
        return Promise.resolve({
          thought: 'I should respond in a friendly way',
          message: 'Hello there! How can I help you today?',
        });
      }
      return Promise.resolve('Default response');
    }),

    // State composition method (used in new implementation)
    composeState: vi.fn().mockResolvedValue('Composed AI response from mock runtime'),

    // Additional methods used in tests
    init: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  // Merge with overrides
  return mockRuntime;
}

/**
 * Creates a mock MattermostConfig for testing
 *
 * @param overrides - Optional overrides for the default config properties
 * @returns A mock config object
 */
export function createMockConfig(overrides: Partial<MattermostConfig> = {}): MattermostConfig {
  return {
    serverUrl: 'https://test.mattermost.com',
    token: 'test-token',
    teamName: 'test-team',
    botUsername: 'test-bot',
    channels: ['general'],
    enableDirectMessages: true,
    enableChannelMessages: true,
    enableThreading: true,
    apiVersion: 'v4',
    connectionTimeout: 30000,
    messageRetryAttempts: 3,
    ...overrides,
  } as MattermostConfig;
}

/**
 * Creates a mock WebSocketClient for testing
 *
 * @param overrides - Optional overrides for the default client methods
 * @returns A mock WebSocket client
 */
export function createMockWebSocketClient(overrides: any = {}) {
  return {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

/**
 * Creates a mock RestClient for testing with new modular structure
 *
 * @param overrides - Optional overrides for the default client methods
 * @returns A mock REST client
 */
export function createMockRestClient(overrides: any = {}) {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    isReady: vi.fn().mockReturnValue(true),
    getBotUser: vi.fn().mockResolvedValue({
      id: 'mock-bot-user-id',
      username: 'mock-bot',
      email: 'mock-bot@test.com',
    }),
    getTeam: vi.fn().mockResolvedValue({
      id: 'mock-team-id',
      name: 'Mock Team',
    }),
    getChannelsForTeam: vi.fn().mockResolvedValue([]),
    getChannelByName: vi.fn().mockResolvedValue({
      id: 'mock-channel-id',
      name: 'mock-channel',
    }),
    joinChannel: vi.fn().mockResolvedValue(undefined),
    
    // Modular client structure
    posts: {
      createPost: vi.fn().mockResolvedValue({
        id: 'mock-post-id',
        create_at: Date.now(),
      }),
      getPost: vi.fn().mockResolvedValue({
        id: 'mock-post-id',
        message: 'Mock post',
      }),
      getPostsForChannel: vi.fn().mockResolvedValue({
        posts: {},
        order: []
      }),
    },
    
    threads: {
      getThreadContext: vi.fn().mockResolvedValue({
        posts: [
          {
            id: 'mock-post-1',
            user_id: 'user-1',
            message: 'Mock thread message',
            create_at: Date.now(),
            username: 'MockUser'
          }
        ],
        messageCount: 1,
        participantCount: 1,
        lastActivity: new Date(),
        isActive: true
      }),
      replyToThread: vi.fn().mockResolvedValue({
        id: 'mock-thread-reply-id',
        create_at: Date.now(),
      }),
    },
    
    // Legacy methods for backwards compatibility (deprecated)
    createPost: vi.fn().mockResolvedValue({
      id: 'mock-post-id',
      create_at: Date.now(),
    }),
    getPostsAroundPost: vi.fn().mockResolvedValue({
      posts: {},
    }),
    getThreadContext: vi.fn().mockResolvedValue({
      posts: [],
      messageCount: 0,
      participantCount: 0,
      lastActivity: new Date(),
      isActive: false
    }),
    
    ...overrides,
  };
}

/**
 * Creates a mock Memory object for testing
 *
 * @param overrides - Optional overrides for the default memory properties
 * @returns A mock memory object
 */
export function createMockMemory(overrides: Partial<Memory> = {}): Partial<Memory> {
  return {
    id: 'test-message-id' as UUID,
    roomId: 'test-room-id' as UUID,
    entityId: 'test-entity-id' as UUID,
    agentId: 'test-agent-id' as UUID,
    content: {
      text: 'Test message',
      source: 'test',
    } as Content,
    createdAt: Date.now(),
    ...overrides,
  };
}

/**
 * Creates a mock State object for testing
 *
 * @param overrides - Optional overrides for the default state properties
 * @returns A mock state object
 */
export function createMockState(overrides: Partial<State> = {}): Partial<State> {
  return {
    ...overrides,
    values: {
      recentMessages: 'User: Test message',
      ...overrides.values,
    },
    data: {
      ...overrides.data,
    },
  };
}

/**
 * Creates a standardized setup for testing with consistent mock objects
 *
 * @param overrides - Optional overrides for default mock implementations
 * @returns An object containing mockRuntime, mockMessage, mockState, and callbackFn
 */
export function setupTest(
  overrides: {
    runtimeOverrides?: Partial<MockRuntime>;
    messageOverrides?: Partial<Memory>;
    stateOverrides?: Partial<State>;
  } = {}
) {
  // Create mock callback function
  const callbackFn = vi.fn();

  // Create a message
  const mockMessage = createMockMemory(overrides.messageOverrides);

  // Create a state object
  const mockState = createMockState(overrides.stateOverrides);

  // Create a mock runtime
  const mockRuntime = createMockRuntime({
    ...overrides.runtimeOverrides,
  });

  return {
    mockRuntime,
    mockMessage,
    mockState,
    callbackFn,
  };
}

/**
 * Type definition for the mock runtime
 */
export interface MockRuntime {
  agentId: UUID;
  character: {
    name: string;
    bio: string;
    [key: string]: unknown;
  };
  services: Map<string, Service>;
  getService: ReturnType<typeof vi.fn>;
  registerService: ReturnType<typeof vi.fn>;
  getSetting: ReturnType<typeof vi.fn>;
  useModel: ReturnType<typeof vi.fn>;
  init: ReturnType<typeof vi.fn>;
  [key: string]: unknown;
}

// Add spy on logger for common usage in tests
export function setupLoggerSpies() {
  vi.spyOn(logger, 'info').mockImplementation(() => {});
  vi.spyOn(logger, 'error').mockImplementation(() => {});
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  vi.spyOn(logger, 'debug').mockImplementation(() => {});

  // allow tests to restore originals
  return () => vi.restoreAllMocks();
}
