# ElizaOS Plugin

This is an ElizaOS plugin built with the official plugin starter template.

## Getting Started

```bash
# Create a new plugin (automatically adds "plugin-" prefix)
elizaos create -t plugin solana
# This creates: plugin-solana
# Dependencies are automatically installed and built

# Navigate to the plugin directory
cd plugin-solana

# Start development immediately
elizaos dev
```

## Development

```bash
# Start development with hot-reloading (recommended)
elizaos dev

# OR start without hot-reloading
elizaos start
# Note: When using 'start', you need to rebuild after changes:
# bun run build

# Test the plugin
elizaos test
```

## Testing

This plugin features a comprehensive, production-ready testing infrastructure with **51 passing tests** across multiple test types:

### Test Structure & Results ✅

- **Unit Tests** (`__tests__/unit/`): Test individual components in isolation
- **Integration Tests** (`__tests__/integration/`): **51 tests passing** - Full REST API and WebSocket integration
- **E2E Tests** (`__tests__/e2e/`): End-to-end message scenarios and ElizaOS runtime integration
- **Manual Tests** (`__tests__/manual/`): Scripts for real-world testing scenarios

### Integration Testing Highlights

Our integration tests validate complete Mattermost functionality:

- ✅ **Authentication & Connection**: Bot user validation, team access, connection testing
- ✅ **Channel Operations**: Get channels by name/ID, validate permissions
- ✅ **Message Operations**: Post, retrieve, update messages with full CRUD support
- ✅ **Error Handling**: Graceful handling of invalid channels, posts, and permissions
- ✅ **Performance**: Concurrent request handling (5+ simultaneous operations)
- ✅ **WebSocket Integration**: Real-time connection management with reconnection logic

### Docker Integration

Complete Docker testing environment with:

- **PostgreSQL**: Test database (port 5433)
- **ElizaOS**: Containerized runtime with plugin integration
- **Automated Setup**: One-command startup with health checks

```bash
# Start Docker integration environment
cd __tests__/integration
docker-compose -f docker-compose.test.yml up -d

# Run integration tests
npm run test:integration
```

### Running Tests

```bash
# All tests
npm run test

# Specific test types
npm run test:unit           # Unit tests only
npm run test:integration    # Integration tests (requires .env)
npm run test:e2e           # E2E tests
npm run test:manual        # Manual testing scripts

# Individual E2E test suites
npm run test:e2e:messaging # Message scenario tests
npm run test:e2e:eliza     # ElizaOS integration tests
```

### Writing Tests

Component tests use Vitest:

```typescript
// Unit test example (__tests__/plugin.test.ts)
describe('Plugin Configuration', () => {
  it('should have correct plugin metadata', () => {
    expect(starterPlugin.name).toBe('plugin-mattermost-client');
  });
});

// Integration test example (__tests__/integration.test.ts)
describe('Integration: HelloWorld Action with StarterService', () => {
  it('should handle HelloWorld action with StarterService', async () => {
    // Test interactions between components
  });
});
```

E2E tests use ElizaOS test interface:

```typescript
// E2E test example (e2e/starter-plugin.test.ts)
export class StarterPluginTestSuite implements TestSuite {
  name = 'plugin_starter_test_suite';
  tests = [
    {
      name: 'example_test',
      fn: async (runtime) => {
        // Test plugin in a real runtime
      },
    },
  ];
}

export default new StarterPluginTestSuite();
```

The test utilities in `__tests__/test-utils.ts` provide mock objects and setup functions to simplify writing tests.

## Publishing & Continuous Development

### Initial Setup

Before publishing your plugin, ensure you meet these requirements:

1. **npm Authentication**

   ```bash
   npm login
   ```

2. **GitHub Repository**

   - Create a public GitHub repository for this plugin
   - Add the 'elizaos-plugins' topic to the repository
   - Use 'main' as the default branch

3. **Required Assets**
   - Add images to the `images/` directory:
     - `logo.jpg` (400x400px square, <500KB)
     - `banner.jpg` (1280x640px, <1MB)

### Initial Publishing

```bash
# Test your plugin meets all requirements
elizaos publish --test

# Publish to npm + GitHub + registry (recommended)
elizaos publish
```

This command will:

- Publish your plugin to npm for easy installation
- Create/update your GitHub repository
- Submit your plugin to the ElizaOS registry for discoverability

### Continuous Development & Updates

**Important**: After your initial publish with `elizaos publish`, all future updates should be done using standard npm and git workflows, not the ElizaOS CLI.

#### Standard Update Workflow

1. **Make Changes**

   ```bash
   # Edit your plugin code
   elizaos dev  # Test locally with hot-reload
   ```

2. **Test Your Changes**

   ```bash
   # Run all tests
   elizaos test

   # Run specific test types if needed
   elizaos test component  # Component tests only
   elizaos test e2e       # E2E tests only
   ```

3. **Update Version**

   ```bash
   # Patch version (bug fixes): 1.0.0 → 1.0.1
   npm version patch

   # Minor version (new features): 1.0.1 → 1.1.0
   npm version minor

   # Major version (breaking changes): 1.1.0 → 2.0.0
   npm version major
   ```

4. **Publish to npm**

   ```bash
   npm publish
   ```

5. **Push to GitHub**
   ```bash
   git push origin main
   git push --tags  # Push version tags
   ```

#### Why Use Standard Workflows?

- **npm publish**: Directly updates your package on npm registry
- **git push**: Updates your GitHub repository with latest code
- **Automatic registry updates**: The ElizaOS registry automatically syncs with npm, so no manual registry updates needed
- **Standard tooling**: Uses familiar npm/git commands that work with all development tools

### Alternative Publishing Options (Initial Only)

```bash
# Publish to npm only (skip GitHub and registry)
elizaos publish --npm

# Publish but skip registry submission
elizaos publish --skip-registry

# Generate registry files locally without publishing
elizaos publish --dry-run
```

## Configuration

The `agentConfig` section in `package.json` defines the parameters your plugin requires:

```json
"agentConfig": {
  "pluginType": "elizaos:plugin:1.0.0",
  "pluginParameters": {
    "API_KEY": {
      "type": "string",
      "description": "API key for the service"
    }
  }
}
```

Customize this section to match your plugin's requirements.

## Documentation

Provide clear documentation about:

- What your plugin does
- How to use it
- Required API keys or credentials
- Example usage
- Version history and changelog

# Mattermost Plugin for ElizaOS

A comprehensive Mattermost integration plugin for ElizaOS that enables real-time bidirectional communication between ElizaOS agents and Mattermost teams.

## ✅ Current Status: **FULLY OPERATIONAL**

### Working Features
- ✅ **Plugin Loading**: Successfully loads into ElizaOS using package name `@bealers/plugin-mattermost`
- ✅ **Authentication**: Bot authenticates to Mattermost servers using access tokens
- ✅ **Direct Messages**: Full bidirectional DM communication working
- ✅ **Channel Mentions**: Responds to @mentions in public channels
- ✅ **WebSocket Connection**: Real-time message processing via WebSocket
- ✅ **AI Integration**: ElizaOS generates contextual responses to messages
- ✅ **Error Handling**: Robust error handling and reconnection logic

### Message Processing Behavior
- **Direct Messages**: Always processed and responded to
- **Channel Messages**: Only processed when the bot is mentioned (e.g., `@hiro hello`)
- **Response Time**: Typically 1-5 seconds for AI response generation
- **Thread Support**: Responses posted as threaded replies

## 🚀 Quick Setup

### Prerequisites
- Node.js 18+ with Bun package manager
- ElizaOS installed and configured
- Mattermost server with bot account and access token

### Installation

1. **Clone and build the plugin:**
```bash
git clone <repository-url>
cd plugin-mattermost
bun install
bun run build
```

2. **Configure your character file:**
Add the plugin to your ElizaOS character file's plugins array:
```json
{
  "plugins": [
    "@elizaos/plugin-bootstrap",
    "@elizaos/plugin-openai",
    "@bealers/plugin-mattermost"
  ]
}
```

3. **Set environment variables:**
Create a `.env` file with your Mattermost configuration:
```env
MATTERMOST_SERVER_URL=https://your-mattermost-server.com
MATTERMOST_BOT_TOKEN=your-bot-access-token
MATTERMOST_BOT_USERNAME=your-bot-username
MATTERMOST_TEAM_NAME=your-team-name
```

4. **Start ElizaOS:**
```bash
elizaos dev --character your-character.json
```

## 📋 Usage

### Direct Messages
Send a direct message to your bot user in Mattermost:
```
Hello! How are you doing?
```
The bot will respond directly in the DM thread.

### Channel Mentions
Mention the bot in any channel where it has access:
```
@your-bot-name what's the weather like today?
```
The bot will respond as a threaded reply to your message.

## 🏗️ Architecture

### Core Components
- **MattermostService**: Main service handling authentication and lifecycle
- **MessageManager**: Processes incoming messages and manages responses  
- **WebSocketClient**: Maintains real-time connection to Mattermost
- **RestClient**: Handles API calls for posting messages and fetching data
- **AttachmentManager**: Manages file uploads and media handling

### Message Flow
1. Mattermost WebSocket receives message event
2. MessageManager filters messages (DMs always processed, channels only if mentioned)
3. ElizaOS generates AI response based on message content and context
4. Response posted back to Mattermost via REST API
5. Message appears as threaded reply in original channel/DM

## 🧪 Testing

The project includes comprehensive test suites:

```bash
# Unit tests
bun test

# Integration tests  
bun run test:integration

# End-to-end tests
bun run test:e2e

# Manual testing
bun run test:manual
```

### Live Testing
1. Start ElizaOS with the plugin loaded
2. Send a DM to your bot: `Hello, are you working?`
3. Mention the bot in a channel: `@bot-name test message`
4. Check ElizaOS logs for message processing confirmation

## 📊 Monitoring

The plugin provides detailed logging for monitoring:
- Connection status and health checks
- Message processing metrics (processing time, response length)
- Error tracking and recovery attempts
- WebSocket connection stability

Example log output:
```
{"msg":"Processing message for AI response","channelName":"general","isMention":true}
{"msg":"AI response generated successfully","responseLength":133,"processingTime":1604}
{"msg":"Response posted successfully"}
```

## 🔧 Configuration

### Environment Variables
| Variable | Description | Required |
|----------|-------------|----------|
| `MATTERMOST_SERVER_URL` | Mattermost server URL | Yes |
| `MATTERMOST_BOT_TOKEN` | Bot access token | Yes |
| `MATTERMOST_BOT_USERNAME` | Bot username | Yes |
| `MATTERMOST_TEAM_NAME` | Team name to join | Yes |
| `MATTERMOST_DEBUG` | Enable debug logging | No |

### Character File Configuration
The plugin is loaded via the character file's plugins array using the package name `@bealers/plugin-mattermost`.

## 🛠️ Development

### Project Structure
```
src/
├── actions/           # ElizaOS action definitions
├── clients/          # REST and WebSocket clients
├── config/           # Configuration and validation
├── managers/         # Message and attachment managers
├── services/         # Main Mattermost service
├── types/           # TypeScript type definitions
└── utils/           # Utility functions and error handling
```

### Building
```bash
bun run build    # Build for production
bun run dev      # Development mode with watch
bun run clean    # Clean build artifacts
```

### Code Quality
```bash
bun run lint     # ESLint checking
bun run format   # Prettier formatting
bun run typecheck # TypeScript validation
```

## 📈 Performance

- **Message Processing**: 1-5 second response times
- **Connection Stability**: Auto-reconnection with exponential backoff
- **Memory Usage**: Efficient message caching and cleanup
- **Throughput**: Handles multiple concurrent conversations

## 🔍 Troubleshooting

### Common Issues

**Plugin not loading:**
- Ensure package name `@bealers/plugin-mattermost` is in character file
- Verify the plugin is built (`dist/index.js` exists)
- Check ElizaOS startup logs for loading errors

**Bot not responding to mentions:**
- Verify the bot has access to the channel
- Ensure the mention format includes the @ symbol
- Check that the bot user is active in Mattermost

**WebSocket connection issues:**
- Verify `MATTERMOST_SERVER_URL` is correct
- Check bot token permissions
- Monitor logs for connection status

### Debug Mode
Enable debug logging by setting `MATTERMOST_DEBUG=true` in your environment.

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

See CONTRIBUTING.md for detailed guidelines.

---

**Status**: Production Ready ✅  
**Last Updated**: January 2025  
**ElizaOS Compatibility**: v2.0+
