# Mattermost elizaOS Plugin

This plugin enables [Mattermost](https://mattermost.com/), the open source team collaboration platform, to act as a client to the [elizaOS](https://github.com/elizaOS/eliza) multi AI agent orchestration system.

Built using the official [Mattermost TypeScript SDK](https://www.npmjs.com/package/@mattermost/client), this plugin enables seamless AI agent communication through Mattermost channels with support for direct messages, thread conversations, and file attachments.

*This plugin is not affiliated with, endorsed by, or sponsored by Mattermost, Inc. Mattermost is a registered trademark of Mattermost, Inc.*

## Features

- **Message Handling**: Process messages from channels and direct messages
- **Thread Support**: Maintain conversation context in Mattermost threads
- **File Attachments**: Send and receive files through Mattermost
- **Channel Management**: Auto-join channels, manage permissions
- **Error Recovery**: Automatic reconnection and error handling

## Installation

```bash
npm install @bealers/plugin-mattermost
```

## Configuration

Add these variables to your elizaOS environment `.env`:

```bash
# Mattermost Configuration
MATTERMOST_URL=https://your-mattermost-server.com
MATTERMOST_TOKEN=your-bot-token
MATTERMOST_BOT_USERNAME=eliza-bot
MATTERMOST_TEAM=your-team-name

# Optional: Channel Configuration
MATTERMOST_DEFAULT_CHANNEL=general
```

### Getting Bot Token

1. Go to Mattermost System Console > Integrations > Bot Accounts
2. Create a new bot account
3. Copy the token to your `.env` file
4. Ensure the bot has access to required channels

## Usage

Add the plugin to your elizaOS character configuration:

```json
{
    "name": "MyHelpfulCharacter",
      "plugins": [
        "@elizaos/plugin-bootstrap",
        "@elizaos/plugin-openai",
        "@bealers/plugin-mattermost"
  ],
}
```

## Testing

The plugin includes a test suite.

```bash
# Run all tests
npm test

# Run specific test categories
npm run test:unit        # Unit tests only
npm run test:coverage    # With coverage report
```

### Test Structure

- `__tests__/unit/` - Component unit tests
- `__tests__/utils/` - Test utilities and mock factories


## Architecture

### Message Flow
1. WebSocket receives message from Mattermost
2. MessageManager processes and filters message
3. elizaOS generates AI response
4. Response sent back through RestClient

### Thread Management
- Each conversation maintains thread context
- Message history preserved for context
- Automatic thread creation for new conversations

### Error Handling
- Connection retry logic with exponential backoff
- Graceful degradation for API failures
- Health monitoring and status reporting

## Contributing

PRs welcome for fixes.


## License

MIT