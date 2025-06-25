/**
 * E2E Test Environment Setup
 * 
 * Provides environment configuration for E2E tests
 * Can be overridden by actual .env file for real testing
 */

// Set up test environment variables if not already set
process.env.MATTERMOST_URL = process.env.MATTERMOST_URL || 'https://mattermost-instance-url.com';
process.env.MATTERMOST_TOKEN = process.env.MATTERMOST_TOKEN || 'test-token-required';
process.env.MATTERMOST_TEAM = process.env.MATTERMOST_TEAM || 'test-team';
process.env.MATTERMOST_BOT_USERNAME = process.env.MATTERMOST_BOT_USERNAME || 'elizaos-bot';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'info';
process.env.MATTERMOST_TEST_CHANNEL = process.env.MATTERMOST_TEST_CHANNEL || 'plugin-test';

/**
 * Check if we have real credentials vs test placeholders
 */
export function hasRealCredentials(): boolean {
  return (
    process.env.MATTERMOST_TOKEN !== 'test-token-required' &&
    process.env.MATTERMOST_TOKEN?.length > 20
  );
}

/**
 * Validate test environment setup
 */
export function validateTestEnvironment(): { valid: boolean; message: string } {
  if (!hasRealCredentials()) {
    return {
      valid: false,
      message: `
E2E tests require real Mattermost credentials.

Please create a .env file with:
MATTERMOST_URL=https://your-mattermost-server.com
MATTERMOST_TOKEN=your-bot-token
MATTERMOST_TEAM=your-team-name

Or set these environment variables directly.
`.trim()
    };
  }

  return {
    valid: true,
    message: 'Test environment is properly configured'
  };
}

// Print warning if using test placeholders
if (!hasRealCredentials()) {
  console.warn('⚠️ E2E tests running with placeholder credentials - tests will be skipped');
} 