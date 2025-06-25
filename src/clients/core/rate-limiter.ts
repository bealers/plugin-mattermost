/**
 * Rate limiter for Mattermost API requests
 */
interface RateLimitState {
  requestCount: number;
  windowStart: number;
  rateLimitReset?: number;
  remainingRequests?: number;
}

export class RateLimiter {
  private static instance: RateLimiter;
  private state: RateLimitState = {
    requestCount: 0,
    windowStart: Date.now(),
    rateLimitReset: undefined,
    remainingRequests: undefined
  };
  
  private readonly maxRequestsPerSecond = 10;
  private readonly windowMs = 1000;

  static getInstance(): RateLimiter {
    if (!RateLimiter.instance) {
      RateLimiter.instance = new RateLimiter();
    }
    return RateLimiter.instance;
  }

  async checkRateLimit(): Promise<void> {
    const now = Date.now();
    
    // Reset window if needed
    if (now - this.state.windowStart >= this.windowMs) {
      this.state.requestCount = 0;
      this.state.windowStart = now;
    }
    
    // Check if we're at the limit
    if (this.state.requestCount >= this.maxRequestsPerSecond) {
      const waitTime = this.windowMs - (now - this.state.windowStart);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
        // Reset after waiting
        this.state.requestCount = 0;
        this.state.windowStart = Date.now();
      }
    }
    
    this.state.requestCount++;
  }

  updateFromHeaders(headers: any): void {
    if (headers) {
      const reset = headers['x-ratelimit-reset'];
      const remaining = headers['x-ratelimit-remaining'];
      
      if (reset) {
        this.state.rateLimitReset = parseInt(reset) * 1000; // Convert to milliseconds
      }
      
      if (remaining) {
        this.state.remainingRequests = parseInt(remaining);
      }
    }
  }
} 