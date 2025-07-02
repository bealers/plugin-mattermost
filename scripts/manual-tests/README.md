# Manual Testing Scripts

This directory contains interactive testing scripts for debugging and end-to-end validation of the Mattermost plugin functionality.

## Available Scripts

### 1. MessageManager Testing (`message-manager-testing.ts`)
Comprehensive test script for MessageManager error handling, resilience, and health monitoring.

**Features:**
- Error handling and retry logic testing
- Circuit breaker validation
- Health monitoring and metrics
- Cache management testing
- Multiple failure scenario simulation
- Real-time performance monitoring

**Usage:**
```bash
npx tsx scripts/manual-tests/message-manager-testing.ts
```

**Test Scenarios:**
- Basic Success Flow
- AI Generation Retry
- Post Failure Recovery  
- Thread Context Failure
- Multiple Failures (Circuit Breaker)

### 2. WebSocket Events Testing (`websocket-events-testing.ts`)
Enhanced WebSocket event system testing with real-time monitoring.

**Features:**
- Multiple event listener testing
- Wildcard event handling
- One-time listeners
- Real-time event monitoring
- Interactive debugging

**Usage:**
```bash
npx tsx scripts/manual-tests/websocket-events-testing.ts
```

**Monitored Events:**
- `posted` - New messages
- `typing` - User typing indicators
- `channel_viewed` - Channel viewing
- `status_change` - User status changes
- Wildcard (`*`) - All events

### 3. Basic WebSocket Testing (`websocket-testing.ts`)
Simple WebSocket connection testing for basic connectivity validation.

**Features:**
- WebSocket connection testing
- Basic event listening
- 30-second live monitoring
- Connection lifecycle testing

**Usage:**
```bash
npx tsx scripts/manual-tests/websocket-testing.ts
```

## Prerequisites

Ensure you have:
1. Valid Mattermost configuration in `.env`
2. Running Mattermost instance
3. Bot account with proper permissions

## Environment Setup

These scripts use the same configuration as the main plugin:
- `MATTERMOST_URL` - Your Mattermost server URL
- `MATTERMOST_TOKEN` - Bot authentication token
- `MATTERMOST_TEAM` - Team name
- `MATTERMOST_BOT_USERNAME` - Bot username

## Purpose

These scripts complement the automated unit and integration tests by providing:
- **End-to-end testing** against real Mattermost instances
- **Interactive debugging** capabilities
- **Real-time monitoring** of events and performance
- **Complex failure scenario** testing
- **Development validation** tools

They are intentionally kept separate from automated tests to avoid interference with CI/CD pipelines while remaining accessible for development and debugging. 