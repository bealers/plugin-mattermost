# Mattermost ElizaOS Plugin

ElizaOS plugin for Mattermost integration. Enables AI agent communication through Mattermost channels with support for direct messages, thread conversations, and file attachments.

PRE-RELEASE TESTING VERSION USE AT YOUR OWN RISK

## Installation

```bash
npm install @elizaos/plugin-mattermost
```

## Configuration

Create a `.env` file in your project root:

```bash
# Mattermost Configuration
MATTERMOST_SERVER_URL=https://your-mattermost-server.com
MATTERMOST_BOT_TOKEN=your-bot-token
MATTERMOST_BOT_USERNAME=eliza-bot
MATTERMOST_TEAM_NAME=your-team-name

# Optional: Channel Configuration
MATTERMOST_DEFAULT_CHANNEL=general
```

### Getting Bot Token

1. Go to Mattermost System Console > Integrations > Bot Accounts
2. Create a new bot account
3. Copy the token to your `.env` file
4. Ensure the bot has access to required channels

## Usage

Add the plugin to your ElizaOS character configuration:

```typescript
import { mattermostPlugin } from '@elizaos/plugin-mattermost';

const character = {
    plugins: [mattermostPlugin],
    // ... other character config
};
```

## Features

- **Message Handling**: Process messages from channels and direct messages
- **Thread Support**: Maintain conversation context in Mattermost threads
- **File Attachments**: Send and receive files through Mattermost
- **Channel Management**: Auto-join channels, manage permissions
- **Error Recovery**: Automatic reconnection and error handling

## API Reference

### Core Components

- `MattermostService`: Main service for Mattermost integration
- `RestClient`: REST API client for Mattermost operations
- `WebSocketClient`: Real-time WebSocket connection management
- `MessageManager`: Handles message processing and AI responses

### Configuration Schema

```typescript
interface MattermostConfig {
    serverUrl: string;
    botToken: string;
    botUsername: string;
    teamName: string;
    defaultChannel?: string;
    maxRetries?: number;
    rateLimitRpm?: number;
}
```

## Development

```bash
# Install dependencies
npm install

# Build the plugin
npm run build

# Run tests
npm test

# Integration tests (requires Mattermost server)
npm run test:integration

# Development with hot reload
npm run dev
```

## Testing

Test structure:
- `__tests__/unit/` - Component unit tests
- `__tests__/integration/` - API integration tests
- `__tests__/e2e/` - End-to-end testing scenarios

Run specific test types:
```bash
npm run test:unit
npm run test:integration
npm run test:e2e
```

## Architecture

### Message Flow
1. WebSocket receives message from Mattermost
2. MessageManager processes and filters message
3. ElizaOS generates AI response
4. Response sent back through RestClient

### Thread Management
- Each conversation maintains thread context
- Message history preserved for context
- Automatic thread creation for new conversations

### Error Handling
- Connection retry logic with exponential backoff
- Graceful degradation for API failures
- Health monitoring and status reporting

## Troubleshooting

### Common Issues

**Connection Failed**
- Verify `MATTERMOST_SERVER_URL` is correct
- Check bot token has proper permissions
- Ensure team name matches exactly

**Bot Not Responding**
- Confirm bot is added to the channel
- Check channel permissions allow bot posting
- Verify WebSocket connection is active

**Authentication Errors**
- Regenerate bot token in System Console
- Ensure token has not expired
- Check bot account is active

### Debug Mode

Enable debug logging:
```bash
DEBUG=mattermost:* npm start
```

## License

MIT
