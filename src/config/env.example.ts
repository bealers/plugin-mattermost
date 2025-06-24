/**
 * Environment configuration template generator
 * Following ElizaOS patterns for secure development setup
 */

/**
 * Generate a safe .env file template with example values
 * This helps developers set up their environment without exposing real credentials
 */
export function generateEnvTemplate(): string {
  return `# Mattermost Plugin Configuration
# Copy this file to .env and replace with your actual values

# Mattermost Server Configuration
MATTERMOST_URL=https://your-mattermost-server.com
MATTERMOST_TOKEN=your_bot_token_here
MATTERMOST_TEAM=your_team_name

# Optional Configuration
MATTERMOST_BOT_USERNAME=elizaos-bot
LOG_LEVEL=info

# WebSocket Configuration (Optional)
MATTERMOST_WS_PING_INTERVAL=30000

# Rate Limiting (Optional)
MATTERMOST_RATE_LIMIT_PER_MINUTE=60

# Note: Never commit the actual .env file to version control
# The .env file should be listed in .gitignore
`;
}

/**
 * Generate environment variable documentation
 */
export function generateEnvDocumentation(): string {
  return `# Environment Variables Documentation

## Required Variables

### MATTERMOST_URL
- **Description**: The base URL of your Mattermost server
- **Example**: \`https://chat.example.com\`
- **Required**: Yes

### MATTERMOST_TOKEN
- **Description**: Bot user token for API authentication
- **How to get**: Create a bot account in Mattermost System Console > Integrations > Bot Accounts
- **Required**: Yes
- **Security**: This is sensitive - never log or expose this value

### MATTERMOST_TEAM
- **Description**: Default team name where the bot will operate
- **Example**: \`main-team\`
- **Required**: Yes

## Optional Variables

### MATTERMOST_BOT_USERNAME
- **Description**: Display username for the bot
- **Default**: \`elizaos-bot\`
- **Required**: No

### LOG_LEVEL
- **Description**: Logging verbosity level
- **Options**: \`debug\`, \`info\`, \`warn\`, \`error\`
- **Default**: \`info\`
- **Required**: No

### MATTERMOST_WS_PING_INTERVAL
- **Description**: WebSocket ping interval in milliseconds
- **Default**: \`30000\` (30 seconds)
- **Required**: No

### MATTERMOST_RATE_LIMIT_PER_MINUTE
- **Description**: Maximum API requests per minute
- **Default**: \`60\`
- **Required**: No

## Security Notes

1. **Never commit .env files** - They contain sensitive tokens
2. **Use different tokens** for development, staging, and production
3. **Rotate tokens regularly** for security
4. **Limit bot permissions** to only what's needed
5. **Monitor bot activity** in Mattermost audit logs
`;
}

/**
 * Validate environment setup and provide helpful guidance
 */
export function validateEnvironmentSetup(): {
  isValid: boolean;
  missingRequired: string[];
  warnings: string[];
  recommendations: string[];
} {
  const required = ['MATTERMOST_URL', 'MATTERMOST_TOKEN', 'MATTERMOST_TEAM'];
  const missingRequired: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Check required variables
  for (const envVar of required) {
    if (!process.env[envVar]) {
      missingRequired.push(envVar);
    }
  }

  // Check for common issues
  if (process.env.MATTERMOST_URL && !process.env.MATTERMOST_URL.startsWith('https://')) {
    warnings.push('MATTERMOST_URL should use HTTPS for security');
  }

  if (process.env.MATTERMOST_TOKEN && process.env.MATTERMOST_TOKEN.length < 20) {
    warnings.push('MATTERMOST_TOKEN appears to be too short - verify it\'s correct');
  }

  // Provide recommendations
  if (!process.env.LOG_LEVEL) {
    recommendations.push('Consider setting LOG_LEVEL for better debugging (debug, info, warn, error)');
  }

  if (!process.env.MATTERMOST_BOT_USERNAME) {
    recommendations.push('Set MATTERMOST_BOT_USERNAME to customize the bot display name');
  }

  return {
    isValid: missingRequired.length === 0,
    missingRequired,
    warnings,
    recommendations,
  };
} 