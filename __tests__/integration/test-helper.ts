import { execSync, spawn, ChildProcess } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface TestEnvironment {
  elizaContainer: ChildProcess | null;
  isRunning: boolean;
  cleanup: () => Promise<void>;
}

export class IntegrationTestHelper {
  private static instance: IntegrationTestHelper;
  private testEnvironment: TestEnvironment | null = null;

  static getInstance(): IntegrationTestHelper {
    if (!IntegrationTestHelper.instance) {
      IntegrationTestHelper.instance = new IntegrationTestHelper();
    }
    return IntegrationTestHelper.instance;
  }

  /**
   * Start Docker containers for integration testing
   * Uses the eliza-coolify approach with docker-compose
   */
  async startTestEnvironment(): Promise<TestEnvironment> {
    if (this.testEnvironment?.isRunning) {
      return this.testEnvironment;
    }

    console.log('🚀 Starting integration test environment...');

    try {
      // Ensure we have required environment variables
      this.validateEnvironment();

      // Start docker-compose services
      const composeFile = join(__dirname, 'docker-compose.test.yml');
      
      console.log('📦 Starting PostgreSQL and ElizaOS containers...');
      execSync(`docker-compose -f ${composeFile} up -d`, {
        stdio: 'inherit',
        cwd: __dirname,
      });

      // Wait for services to be healthy
      console.log('⏳ Waiting for services to be ready...');
      await this.waitForServices();

      this.testEnvironment = {
        elizaContainer: null, // Managed by docker-compose
        isRunning: true,
        cleanup: this.cleanup.bind(this),
      };

      console.log('✅ Integration test environment ready!');
      return this.testEnvironment;

    } catch (error) {
      console.error('❌ Failed to start test environment:', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Wait for all services to be healthy
   */
  private async waitForServices(): Promise<void> {
    const maxWaitTime = 120000; // 2 minutes
    const checkInterval = 5000; // 5 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      try {
        // Check PostgreSQL
        execSync('docker-compose -f docker-compose.test.yml exec -T postgres-test pg_isready -U eliza', {
          stdio: 'pipe',
          cwd: __dirname,
        });

        // Check ElizaOS health endpoint
        const healthCheck = execSync('curl -f http://localhost:3001/health || echo "unhealthy"', {
          stdio: 'pipe',
          encoding: 'utf8',
        });

        if (!healthCheck.includes('unhealthy')) {
          console.log('✅ All services are healthy');
          return;
        }

      } catch (error) {
        // Services not ready yet, continue waiting
      }

      console.log('⏳ Services not ready yet, waiting...');
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    throw new Error('Services failed to become healthy within timeout period');
  }

  /**
   * Validate required environment variables
   */
  private validateEnvironment(): void {
    const required = [
      'MATTERMOST_BOT_TOKEN',
      'MATTERMOST_SERVER_URL',
      'OPENAI_API_KEY',
    ];

    const missing = required.filter(env => !process.env[env]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }

  /**
   * Clean up test environment
   */
  async cleanup(): Promise<void> {
    if (!this.testEnvironment?.isRunning) {
      return;
    }

    console.log('🧹 Cleaning up test environment...');

    try {
      const composeFile = join(__dirname, 'docker-compose.test.yml');
      
      // Stop and remove containers
      execSync(`docker-compose -f ${composeFile} down -v`, {
        stdio: 'inherit',
        cwd: __dirname,
      });

      this.testEnvironment.isRunning = false;
      console.log('✅ Test environment cleaned up');

    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }

  /**
   * Get logs from ElizaOS container for debugging
   */
  async getElizaLogs(): Promise<string> {
    try {
      const logs = execSync('docker-compose -f docker-compose.test.yml logs elizaos-test', {
        encoding: 'utf8',
        cwd: __dirname,
      });
      return logs;
    } catch (error) {
      console.error('Failed to get ElizaOS logs:', error);
      return 'Failed to retrieve logs';
    }
  }

  /**
   * Check if ElizaOS is responding
   */
  async isElizaHealthy(): Promise<boolean> {
    try {
      const response = execSync('curl -f http://localhost:3001/health', {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      return response.includes('healthy') || response.includes('ok');
    } catch {
      return false;
    }
  }

  /**
   * Restart ElizaOS service (useful for resilience testing)
   */
  async restartEliza(): Promise<void> {
    console.log('🔄 Restarting ElizaOS service...');
    
    const composeFile = join(__dirname, 'docker-compose.test.yml');
    
    execSync(`docker-compose -f ${composeFile} restart elizaos-test`, {
      stdio: 'inherit',
      cwd: __dirname,
    });

    // Wait for service to be healthy again
    await this.waitForServices();
    console.log('✅ ElizaOS service restarted');
  }
}

/**
 * Test utilities for message testing
 */
export class MessageTestUtils {
  static generateTestMessage(prefix: string = 'test'): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    return `${prefix}-${timestamp}-${random}`;
  }

  static createMention(username: string, message: string): string {
    return `@${username} ${message}`;
  }

  static async waitForMessage(
    client: any,
    event: string,
    predicate: (data: any) => boolean,
    timeout: number = 30000
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        client.off(event, handler);
        reject(new Error(`Timeout waiting for ${event} message`));
      }, timeout);

      const handler = (data: any) => {
        if (predicate(data)) {
          clearTimeout(timer);
          client.off(event, handler);
          resolve(data);
        }
      };

      client.on(event, handler);
    });
  }
}

/**
 * Global test setup and teardown
 */
export const integrationTestHelper = IntegrationTestHelper.getInstance(); 