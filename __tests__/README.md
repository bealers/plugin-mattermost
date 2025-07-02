# Testing Guide

This project uses a containerized testing approach so you don't have to hammer the server in functional testing.

## Quick Start

```bash
# Setup containerized test environment (once)
npm run test:setup

# Run tests against containers
npm run test

# Cleanup when done
npm run test:teardown
```

## How It Works

1. **Containerized Mattermost**: Tests run against a Docker container (localhost:8066)
2. **Automatic Configuration**: Test config is generated automatically 
3. **Your .env Stays Safe**: No accidental .env munging
4. **Dummy Data**: All test data is temporary and disposable

## Test Types

- `npm run test` - All tests (unit + integration)
- `npm run test:unit` - Unit tests only
- `npm run test:integration` - Integration tests (requires container)
- `npm run test:e2e` - End-to-end tests (requires container)

## Test Environment

When you run `npm run test:setup`, it:
- Starts Mattermost + PostgreSQL containers
- Creates test team, channels, and bot account
- Generates test configuration automatically
- Your tests automatically use this configuration