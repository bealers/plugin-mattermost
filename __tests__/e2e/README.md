# End-to-End Integration Testing

This directory contains comprehensive end-to-end (E2E) integration tests for the Mattermost-ElizaOS plugin system.

## Overview

The E2E tests validate the complete messaging pipeline from production Mattermost through the plugin components to local ElizaOS Docker containers and back.

**Test Architecture:**
```
Production Mattermost ↔ Plugin Components ↔ Local ElizaOS Docker
```

## Test Suites

### 1. Message Scenarios (`message-scenarios.e2e.test.ts`)

Tests real-world message flows using production Mattermost server integration.

**Test Coverage:**
- **Basic Message Posting**: Simple message creation and bot mentions
- **WebSocket Event Reception**: Real-time event handling and processing
- **Message Manager Integration**: Mention detection and message processing pipeline
- **Connection Resilience**: WebSocket reconnection and error recovery
- **Message Format Handling**: Markdown, long messages, and special content

**Key Scenarios:**
1. Post message to test channel and verify delivery
2. Send bot mention and verify WebSocket event reception
3. Handle multiple concurrent messages without conflicts
4. Detect and process mentions through Message Manager
5. Gracefully handle message processing errors
6. Reconnect WebSocket after disconnection
7. Process messages with markdown formatting
8. Handle messages exceeding character limits

### 2. ElizaOS Integration (`elizaos-integration.e2e.test.ts`)

Tests Docker orchestration and message processing through ElizaOS.

**Test Coverage:**
- **ElizaOS Docker Environment**: Container health and API communication
- **Message Processing**: AI response generation through ElizaOS
- **Response Delivery**: Message routing back to Mattermost
- **Error Scenarios**: Service unavailability and timeout handling
- **Plugin Lifecycle**: Initialization and graceful shutdown

**Key Scenarios:**
1. Verify ElizaOS container running and healthy
2. Communicate with ElizaOS API endpoints
3. Process simple mentions through ElizaOS pipeline
4. Handle complex messages with context preservation
5. Deliver ElizaOS responses back to Mattermost channels
6. Handle ElizaOS container unavailability gracefully
7. Manage slow ElizaOS responses and timeouts
8. Initialize plugin with ElizaOS environment
9. Perform graceful shutdown and cleanup

### 3. Complete Message Flow (`complete-messaging-flow.e2e.test.ts`)

Tests the entire pipeline with comprehensive real-world scenarios.

**Test Coverage:**
- **Basic Message Flow**: End-to-end mention processing with ElizaOS
- **Multi-Turn Conversations**: Context preservation across messages
- **Error Handling**: Service failures and recovery mechanisms
- **Message Format Validation**: Content processing and response formatting
- **Real-time Synchronization**: WebSocket event coordination

**Key Scenarios:**
1. Handle bot mention and generate ElizaOS response
2. Process direct messages without explicit mentions
3. Maintain conversation context across multiple messages
4. Gracefully handle ElizaOS service failures
5. Manage WebSocket disconnection and reconnection
6. Process messages with special characters and formatting
7. Handle long messages and enforce limits
8. Receive WebSocket events in real-time
9. Handle concurrent messages correctly

## Configuration & Setup

### Environment Variables

E2E tests require real Mattermost credentials. Create a `.env` file:

```env
MATTERMOST_URL=https://your-mattermost-server.com
MATTERMOST_TOKEN=your-bot-token
MATTERMOST_TEAM=your-team-name
MATTERMOST_BOT_USERNAME=elizaos-bot
MATTERMOST_TEST_CHANNEL=plugin-test
LOG_LEVEL=info
```

### Smart Credential Detection

Tests automatically detect available credentials:

- **Real Credentials**: Full integration testing with live Mattermost server
- **Placeholder Credentials**: Tests skip gracefully with informative messages
- **CI/Development**: Safe execution without real server dependencies

### Test Environment Setup

The test framework includes:

1. **Automatic Environment Validation**: Checks credentials and Docker availability
2. **Smart Test Skipping**: Graceful handling when real credentials unavailable
3. **Resource Cleanup**: Automatic message and container cleanup
4. **Error Isolation**: Tests don't interfere with each other

## Running Tests

### Individual Test Suites

```bash
# Message scenario tests
npm run test:e2e:messaging

# ElizaOS integration tests  
npm run test:e2e:eliza

# All E2E tests
npm run test:e2e
```

### Test Configuration

E2E tests use dedicated configuration (`vitest.e2e.config.ts`) with:
- Extended timeouts (3 minutes for E2E, 1 minute for setup)
- Node environment for Docker operations
- Verbose reporting for detailed feedback
- Environment setup with credential validation

## Docker Integration

### ElizaOS Container Management

Tests use the `IntegrationTestHelper` for Docker operations:

- **Container Orchestration**: Start/stop ElizaOS containers
- **Health Monitoring**: Wait for service availability
- **Network Configuration**: Proper container networking
- **Resource Management**: Automatic cleanup and resource freeing

### Container Architecture

Based on `eliza-coolify` approach:
- PostgreSQL database container
- ElizaOS application container
- Network isolation and port mapping
- Volume management for persistence

## Test Data Management

### Message Tracking

All tests implement comprehensive cleanup:

```typescript
const sentMessages: string[] = [];

// Track all created messages
sentMessages.push(post.id);

// Cleanup in afterAll
for (const messageId of sentMessages) {
  await restClient.deletePost(messageId);
}
```

### Event Monitoring

WebSocket events are tracked and validated:

```typescript
const receivedEvents: any[] = [];

wsClient.on('posted', (event) => {
  receivedEvents.push({
    type: 'posted',
    timestamp: Date.now(),
    data: event
  });
});
```

## Expected Outcomes

### Successful Test Execution

When real credentials are provided:

1. **All Tests Pass**: Complete pipeline validation
2. **Real-time Events**: WebSocket synchronization verified
3. **ElizaOS Responses**: AI-generated content delivered to Mattermost
4. **Clean Execution**: No test artifacts left in production
5. **Performance Validation**: Response times within acceptable limits

### Credential-Free Execution

When no real credentials available:

1. **Graceful Skipping**: Tests skip with clear messaging
2. **Fast Execution**: No network calls or timeouts
3. **Clean CI/CD**: Safe for automated pipelines
4. **Developer Friendly**: Clear setup instructions provided

## Troubleshooting

### Common Issues

1. **Credential Errors**: Verify `.env` file exists with correct values
2. **Docker Issues**: Ensure Docker daemon running and accessible
3. **Network Problems**: Check Mattermost server accessibility
4. **Timeout Errors**: Verify ElizaOS container startup performance

### Debug Information

Enable detailed logging:

```env
LOG_LEVEL=debug
```

Review test output for:
- Environment validation results
- Docker container status
- WebSocket connection events
- ElizaOS API responses

## Architecture Diagrams

### Message Flow Pipeline

```
[User Message] 
    ↓
[Mattermost Server] 
    ↓ (WebSocket)
[Plugin WebSocket Client] 
    ↓
[Message Manager] 
    ↓ (mention detection)
[ElizaOS Integration] 
    ↓ (Docker API)
[ElizaOS Container] 
    ↓ (AI processing)
[Response Generation] 
    ↓
[Mattermost REST API] 
    ↓
[Channel Response]
```

### Test Architecture

```
[E2E Test Suite]
    ├── [Message Scenarios] → [Production Mattermost]
    ├── [ElizaOS Integration] → [Local Docker]
    └── [Complete Flow] → [Both Systems]
```

## Maintenance Guidelines

### Adding New Test Scenarios

1. **Follow Naming Conventions**: Use descriptive `should...` format
2. **Include Credential Checks**: Add `hasRealCredentials()` guard
3. **Implement Cleanup**: Track and remove test artifacts
4. **Add Documentation**: Update this README with new scenarios

### Updating Test Infrastructure

1. **Environment Setup**: Modify `test-env.setup.ts` for new variables
2. **Docker Configuration**: Update `IntegrationTestHelper` for container changes
3. **Test Configuration**: Adjust `vitest.e2e.config.ts` for performance tuning
4. **CI Integration**: Ensure graceful skipping continues working

This comprehensive testing framework ensures reliable development and deployment of the Mattermost-ElizaOS integration while maintaining production server safety and developer experience quality. 