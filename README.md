# Mattermost elizaOS Plugin (Client)

This plugin enables [Mattermost](https://mattermost.com/), the open source team collaboration platform, to act as a client to the [elizaOS](https://github.com/elizaOS/eliza) AI agentic system. 

Built using the official [Mattermost TypeScript SDK](https://www.npmjs.com/package/@mattermost/client), this plugin enables seamless AI agent communication through Mattermost channels with support for direct messages, thread conversations, and file attachments.

## Features

- **Message Handling**: Process messages from channels and direct messages
- **Thread Support**: Maintain conversation context in Mattermost threads
- **File Attachments**: Send and receive files through Mattermost
- **Channel Management**: Auto-join channels, manage permissions
- **Error Recovery**: Automatic reconnection and error handling
- **Testing:** Features comprehensive automated testing using containerized Mattermost instances. All tests run locally with automatic environment management.

_**PRE-RELEASE TESTING VERSION USE AT YOUR OWN RISK**_

## Installation

```bash
npm install @bealers/plugin-mattermost
```

## Configuration

Add these variables to your elizaOS environment `.env:`

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
    "plugins": ["@elizaos/plugin-mattermost"],
    "settings": {
        "secrets": {},
        "voice": {
            "model": "en_US-hfc_female-medium"
        }
    }
}
```


## Testing

### Quick Start

```bash
# Setup containerized test environment (once)
npm run test:setup

# Run all tests
npm test

# Cleanup when done
npm run test:teardown
```

### Test Types

**Automated Tests:**
- `npm test` - All tests (unit + integration)
- `npm run test:unit` - Unit tests only  
- `npm run test:integration` - Integration tests (requires container)
- `npm run test:e2e` - End-to-end tests (requires container)

**Manual/Interactive Tests:**
- `npx tsx scripts/manual-tests/message-manager-testing.ts` - MessageManager error handling & circuit breakers
- `npx tsx scripts/manual-tests/websocket-events-testing.ts` - Real-time WebSocket event monitoring
- `npx tsx scripts/manual-tests/websocket-testing.ts` - Basic WebSocket connection testing

### Test Structure

- `__tests__/unit/` - Component unit tests
- `__tests__/integration/` - API integration tests  
- `__tests__/e2e/` - End-to-end testing scenarios
- `scripts/manual-tests/` - Interactive debugging scripts

### Detailed Documentation

For comprehensive testing information:
- **[Testing Guide](__tests__/README.md)** - Complete containerized testing setup and troubleshooting
- **[Manual Testing Scripts](scripts/manual-tests/README.md)** - Interactive debugging tools and usage instructions

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

## License

MIT