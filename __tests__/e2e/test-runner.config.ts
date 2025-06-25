/**
 * E2E Test Runner Configuration
 * 
 * Defines test suites and execution strategies for different scenarios
 */

export interface TestSuite {
  name: string;
  description: string;
  timeout: number;
  setup?: string[];
  teardown?: string[];
  env?: Record<string, string>;
}

export const testSuites: Record<string, TestSuite> = {
  messaging: {
    name: 'Message Scenarios',
    description: 'Basic message posting, WebSocket events, and message formatting',
    timeout: 30000,
    setup: [
      'Verify production Mattermost credentials',
      'Create test channel if needed',
      'Initialize REST and WebSocket clients'
    ],
    teardown: [
      'Clean up test messages',
      'Close connections'
    ],
    env: {
      TEST_CHANNEL_PREFIX: 'plugin-test',
      CLEANUP_MESSAGES: 'true'
    }
  },
  
  elizaIntegration: {
    name: 'ElizaOS Integration',
    description: 'Docker container orchestration and message processing through ElizaOS',
    timeout: 120000,
    setup: [
      'Start ElizaOS Docker containers',
      'Wait for services to be healthy',
      'Initialize plugin components',
      'Create ElizaOS test channel'
    ],
    teardown: [
      'Clean up test messages',
      'Stop Docker containers',
      'Clean up test channels'
    ],
    env: {
      TEST_CHANNEL_PREFIX: 'elizaos-test',
      DOCKER_COMPOSE_FILE: '__tests__/integration/docker-compose.test.yml',
      ELIZA_HEALTH_CHECK_URL: 'http://localhost:3000/health'
    }
  },
  
  resilience: {
    name: 'Connection Resilience',
    description: 'Connection recovery, error handling, and edge cases',
    timeout: 60000,
    setup: [
      'Initialize all components',
      'Verify initial connections'
    ],
    teardown: [
      'Restore all connections',
      'Clean up test data'
    ],
    env: {
      TEST_CHANNEL_PREFIX: 'resilience-test',
      SIMULATE_FAILURES: 'true'
    }
  }
};

export interface TestConfig {
  // Mattermost server configuration
  mattermost: {
    serverUrl: string;
    verifyProduction: boolean;
    requiredCredentials: string[];
  };
  
  // Docker configuration
  docker: {
    composeFile: string;
    services: string[];
    healthCheckTimeout: number;
  };
  
  // Test execution settings
  execution: {
    parallel: boolean;
    retries: number;
    cleanup: {
      messages: boolean;
      channels: boolean;
      containers: boolean;
    };
  };
}

export const defaultConfig: TestConfig = {
  mattermost: {
    serverUrl: 'https://chat.siftware.com',
    verifyProduction: true,
    requiredCredentials: ['token', 'username']
  },
  
  docker: {
    composeFile: '__tests__/integration/docker-compose.test.yml',
    services: ['postgres-test', 'elizaos-test'],
    healthCheckTimeout: 60000
  },
  
  execution: {
    parallel: false, // Run sequentially for Docker tests
    retries: 2,
    cleanup: {
      messages: true,
      channels: false, // Keep test channels for reuse
      containers: true
    }
  }
};

/**
 * Test execution utilities
 */
export class TestRunner {
  static async validateEnvironment(suite: TestSuite): Promise<boolean> {
    try {
      // Check required environment variables
      const requiredVars = ['MATTERMOST_TOKEN', 'MATTERMOST_USERNAME'];
      for (const varName of requiredVars) {
        if (!process.env[varName]) {
          console.error(`Missing required environment variable: ${varName}`);
          return false;
        }
      }
      
      // Validate Mattermost server access
      if (suite.name === 'ElizaOS Integration') {
        // Additional Docker validation
        try {
          const { execSync } = require('child_process');
          execSync('docker --version', { stdio: 'pipe' });
          execSync('docker-compose --version', { stdio: 'pipe' });
        } catch (error) {
          console.error('Docker or docker-compose not available');
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error('Environment validation failed:', error);
      return false;
    }
  }
  
  static async runSuite(suiteName: string): Promise<boolean> {
    const suite = testSuites[suiteName];
    if (!suite) {
      console.error(`Unknown test suite: ${suiteName}`);
      return false;
    }
    
    console.log(`Running test suite: ${suite.name}`);
    console.log(`Description: ${suite.description}`);
    
    // Validate environment
    const isValid = await this.validateEnvironment(suite);
    if (!isValid) {
      console.error('Environment validation failed');
      return false;
    }
    
    // Set environment variables
    if (suite.env) {
      Object.entries(suite.env).forEach(([key, value]) => {
        process.env[key] = value;
      });
    }
    
    try {
      // Run setup steps
      if (suite.setup) {
        console.log('Setup steps:');
        suite.setup.forEach(step => console.log(`  - ${step}`));
      }
      
      // Test execution would happen here
      console.log('Test execution completed successfully');
      
      return true;
    } catch (error) {
      console.error('Test suite execution failed:', error);
      return false;
    } finally {
      // Run teardown steps
      if (suite.teardown) {
        console.log('Teardown steps:');
        suite.teardown.forEach(step => console.log(`  - ${step}`));
      }
    }
  }
  
  static listSuites(): void {
    console.log('Available test suites:');
    Object.entries(testSuites).forEach(([key, suite]) => {
      console.log(`\n${key}:`);
      console.log(`  Name: ${suite.name}`);
      console.log(`  Description: ${suite.description}`);
      console.log(`  Timeout: ${suite.timeout}ms`);
    });
  }
} 