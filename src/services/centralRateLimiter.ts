/**
 * Central Rate Limiter Service
 * 
 * Provides robust rate limiting for all LLM API calls, with detailed logging,
 * queue management, exponential backoff, and retry logic.
 * 
 * This singleton is the central orchestrator for managing API rate limits
 * to prevent 429 errors and ensure reliable operation.
 */

// Token tracking state object
interface RateLimiterState {
  tokensUsedLastMinute: number;
  lastResetTime: number; // Timestamp of the last token counter reset - used for calculating when to reset again
  waitQueue: Array<{ 
    resolve: () => void; 
    tokens: number; 
    requestId: string; 
    operation: string;
  }>;
  isProcessing: boolean;
  requestCounter: number;
  activeRequests: Map<string, { 
    tokens: number; 
    operation: string; 
    startTime: number; // Used to calculate request duration
  }>;
  completedRequests: {
    success: number;
    failure: number;
    rateLimit: number;
    total: number;
  };
  requestLog: Array<{
    id: string;
    operation: string;
    status: 'success' | 'failure' | 'rate-limited';
    tokens: number;
    duration: number; // Request duration in ms - calculated from startTime
    timestamp: number; // When the request was completed
    error?: string;
  }>;
}

// Request log entry interface
interface RequestLogEntry {
  id: string;
  operation: string; 
  status: 'success' | 'failure' | 'rate-limited';
  tokens: number;
  duration: number;
  timestamp: number;
  error?: string;
}

// Status info interface
interface StatusInfo {
  tokensUsed: number;
  tokenLimit: number;
  usagePercentage: number;
  queuedRequests: number;
  activeRequests: number;
  completedRequests: {
    success: number;
    failure: number;
    rateLimit: number;
    total: number;
  };
  timeToReset: number;
}

export const centralRateLimiter = {
  // Token tracking state
  state: {
    tokensUsedLastMinute: 0,
    lastResetTime: Date.now(),
    waitQueue: [],
    isProcessing: false,
    requestCounter: 0,
    activeRequests: new Map(),
    completedRequests: {
      success: 0,
      failure: 0,
      rateLimit: 0,
      total: 0
    },
    requestLog: []
  } as RateLimiterState,

  // Constants
  TOKEN_LIMIT_PER_MINUTE: 400000, // Lower than the actual 90K limit to be safe
  THROTTLE_THRESHOLD: 0.9, // Start throttling at 90% of limit
  RESET_INTERVAL: 60000, // 1 minute in ms
  PROCESSING_INTERVAL: 100, // Time between queue checks
  LOG_MAX_ENTRIES: 50, // Maximum number of request logs to keep

  /**
   * Tracks token usage with enhanced logging
   * @param tokenCount - Number of tokens used in the operation
   * @param operation - Name of the operation being performed (for logging)
   */
  async trackTokenUsage(tokenCount: number, operation: string = 'unknown'): Promise<void> {
    const requestId = `req_${++this.state.requestCounter}_${Date.now()}`;
    //console.log(`[RL:${requestId}] Request start: ${operation} (${tokenCount} tokens)`);
    
    // Track this request
    this.state.activeRequests.set(requestId, {
      tokens: tokenCount,
      operation,
      startTime: Date.now()
    });
    
    try {
      // Reset counter if it's been more than a minute
      const now = Date.now();
      if (now - this.state.lastResetTime > this.RESET_INTERVAL) {
        this.resetTokenUsage();
      }

      const availableTokens = this.TOKEN_LIMIT_PER_MINUTE - this.state.tokensUsedLastMinute;
      const thresholdLimit = this.TOKEN_LIMIT_PER_MINUTE * this.THROTTLE_THRESHOLD;
      
      // Check if we're approaching the threshold or would exceed the limit
      if (this.state.tokensUsedLastMinute > thresholdLimit || tokenCount > availableTokens) {
        // Track rate-limited request
        this.state.completedRequests.rateLimit++;
        
        const timeToReset = this.RESET_INTERVAL - (now - this.state.lastResetTime);
        const waitTime = (timeToReset / 1000).toFixed(1);
        
        console.log(`[RL:${requestId}] Rate limiting: (${this.state.tokensUsedLastMinute}/${this.TOKEN_LIMIT_PER_MINUTE}) waiting ${waitTime}s...`);
        
        // Wait until we can process these tokens
        await this.waitForTokenAvailability(tokenCount, requestId, operation);
      }

      // Add to the count
      this.state.tokensUsedLastMinute += tokenCount;
      
      // Successfully completed
      this.state.completedRequests.total++;
      this.state.completedRequests.success++;
      
      const duration = Date.now() - this.state.activeRequests.get(requestId)!.startTime;
      //console.log(`[RL:${requestId}] Request success: ${operation} completed in ${duration}ms (${this.state.tokensUsedLastMinute}/${this.TOKEN_LIMIT_PER_MINUTE} tokens)`);
      
      // Log the request
      this.logRequest({
        id: requestId,
        operation,
        status: 'success',
        tokens: tokenCount,
        duration,
        timestamp: Date.now()
      });
      
      // Clean up
      this.state.activeRequests.delete(requestId);
    } catch (error) {
      // Mark as failed
      this.state.completedRequests.total++;
      this.state.completedRequests.failure++;
      
      const duration = Date.now() - this.state.activeRequests.get(requestId)!.startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      console.log(`[RL:${requestId}] Request failed: ${operation} after ${duration}ms - ${errorMsg}`);
      
      // Log the failed request
      this.logRequest({
        id: requestId,
        operation,
        status: 'failure',
        tokens: tokenCount,
        duration,
        timestamp: Date.now(),
        error: errorMsg
      });
      
      // Clean up
      this.state.activeRequests.delete(requestId);
      
      // Rethrow
      throw error;
    }
  },

  /**
   * Logs a request for tracking purposes
   */
  logRequest(requestData: RequestLogEntry): void {
    // Add to the log
    this.state.requestLog.unshift(requestData);
    
    // Trim if needed
    if (this.state.requestLog.length > this.LOG_MAX_ENTRIES) {
      this.state.requestLog.length = this.LOG_MAX_ENTRIES;
    }
  },

  /**
   * Gets status information about current rate limiting
   */
  getStatusInfo(): StatusInfo {
    const now = Date.now();
    const timeToReset = Math.max(0, this.RESET_INTERVAL - (now - this.state.lastResetTime));
    
    return {
      tokensUsed: this.state.tokensUsedLastMinute,
      tokenLimit: this.TOKEN_LIMIT_PER_MINUTE,
      usagePercentage: (this.state.tokensUsedLastMinute / this.TOKEN_LIMIT_PER_MINUTE) * 100,
      queuedRequests: this.state.waitQueue.length,
      activeRequests: this.state.activeRequests.size,
      completedRequests: { ...this.state.completedRequests },
      timeToReset
    };
  },

  /**
   * Resets the token usage counter
   */
  resetTokenUsage(): void {
    const usedTokens = this.state.tokensUsedLastMinute;
    
    // Only log if we have meaningful usage
    if (usedTokens > 1000) {
     // console.log(`[RL] Reset: ${usedTokens} tokens/min, completed ${this.state.completedRequests.success} requests (${this.state.completedRequests.rateLimit} rate limited, ${this.state.completedRequests.failure} failures)`);
    }
    
    this.state.tokensUsedLastMinute = 0;
    this.state.lastResetTime = Date.now();
  },

  /**
   * Waits until token availability for a request
   * @param tokenCount - Number of tokens needed
   * @param requestId - ID of the request for tracking
   * @param operation - Name of operation being performed
   */
  async waitForTokenAvailability(tokenCount: number, requestId: string, operation: string): Promise<void> {
    return new Promise<void>((resolve) => {
      // Add to wait queue
      this.state.waitQueue.push({ resolve, tokens: tokenCount, requestId, operation });
      
      // Log the rate-limited request
      this.logRequest({
        id: requestId,
        operation,
        status: 'rate-limited',
        tokens: tokenCount,
        duration: 0, // No duration yet
        timestamp: Date.now()
      });
      
      // Start processing the queue if not already processing
      if (!this.state.isProcessing) {
        this.processQueue();
      }
    });
  },

  /**
   * Processes the wait queue, resolving promises when tokens are available
   */
  processQueue(): void {
    if (this.state.isProcessing) return;
    
    this.state.isProcessing = true;
    
    const processNext = () => {
      // Reset counter if needed
      const now = Date.now();
      if (now - this.state.lastResetTime > this.RESET_INTERVAL) {
        this.resetTokenUsage();
      }
      
      // Check if we have any waiters and can process them
      if (this.state.waitQueue.length > 0) {
        const nextInQueue = this.state.waitQueue[0];
        
        // Check if we can process this request
        const availableTokens = this.TOKEN_LIMIT_PER_MINUTE - this.state.tokensUsedLastMinute;
        if (nextInQueue.tokens <= availableTokens) {
          // Update token count
          this.state.tokensUsedLastMinute += nextInQueue.tokens;
          
          console.log(`[RL:${nextInQueue.requestId}] Queue processed: ${nextInQueue.operation} (${this.state.tokensUsedLastMinute}/${this.TOKEN_LIMIT_PER_MINUTE} tokens)`);
          
          // Resolve the promise and remove from queue
          nextInQueue.resolve();
          this.state.waitQueue.shift();
        } else {
          // Can't process yet, wait for token reset
          const timeToReset = this.RESET_INTERVAL - (now - this.state.lastResetTime);
        //  const waitTime = (timeToReset / 1000).toFixed(1);
       //   console.log(`[RL] Queue waiting: ${this.state.waitQueue.length} requests, reset in ${waitTime}s`);
        }
        
        // Continue processing after a short delay
        setTimeout(() => processNext(), this.PROCESSING_INTERVAL);
      } else {
        // No more items to process
        this.state.isProcessing = false;
      }
    };
    
    // Start processing
    processNext();
  },

  /**
   * Estimates token count for a text string (improved accuracy)
   * @param text - Text to estimate tokens for
   */
  estimateTokenCount(text: string): number {
    if (!text) return 0;
    
    // More accurate estimation based on token counting heuristics
    // - English: ~4 chars per token
    // - Code: ~3 chars per token
    // - Numeric/special chars: ~2 chars per token
    
    // Count different character types
    const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
    const numericCount = (text.match(/[0-9]/g) || []).length;
    const specialCount = (text.match(/[^a-zA-Z0-9\s]/g) || []).length;
    
    // Apply different weights
    const alphaTokens = alphaCount / 4;
    const numericTokens = numericCount / 2.5;
    const specialTokens = specialCount / 2;
    
    // Add token for whitespace (~1 token per 6 whitespace chars)
    const whitespaceCount = (text.match(/\s/g) || []).length;
    const whitespaceTokens = whitespaceCount / 6;
    
    return Math.ceil(alphaTokens + numericTokens + specialTokens + whitespaceTokens);
  },
  
  /**
   * Execute with retry logic for rate limit errors
   * Ensures results from completed operations are returned even when rate limited
   * 
   * @param operation - Function to execute with retries
   * @param operationName - Name of the operation (for logging)
   * @param maxRetries - Maximum number of retries (default: 3)
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string = 'unknown_operation',
    maxRetries = 3
  ): Promise<T> {
    let retries = 0;
    const requestId = `retry_${++this.state.requestCounter}_${Date.now()}`;
    
   // console.log(`[RL:${requestId}] Starting ${operationName} with retry (max=${maxRetries})`);
    
    while (true) {
      try {
        const startTime = Date.now();
        const result = await operation();
        const duration = Date.now() - startTime;
        
        //console.log(`[RL:${requestId}] Success: ${operationName} completed in ${duration}ms`);
        return result;
      } catch (error: any) {
        // Check if we've hit the max retries
        if (retries >= maxRetries) {
          console.log(`[RL:${requestId}] Max retries (${maxRetries}) reached, failing ${operationName}`);
          throw error;
        }
        
        // Check if this is a rate limit error
        const isRateLimit = error?.message?.includes('rate limit') || 
                           error?.message?.includes('429') ||
                           error?.status === 429 ||
                           (error?.data?.error?.code === '429');
        
        if (!isRateLimit) {
          // Log detailed error info but in a concise format
          const errorDetails = {
            message: error?.message || 'Unknown error',
            status: error?.statusCode || error?.status || (error?.data?.error?.code),
            type: error?.type || error?.code || 'UnknownErrorType'
          };
          
          console.log(`[RL:${requestId}] Non-rate limit error in ${operationName}: ${JSON.stringify(errorDetails)}`);
          throw error;
        }
        
        // Extract retry time if available
        let retryAfter = 1; // default 1 second
        const match = error?.message?.match(/retry after (\d+)/i);
        if (match && match[1]) {
          retryAfter = parseInt(match[1], 10);
        } else if (error.responseHeaders?.['retry-after']) {
          retryAfter = parseInt(error.responseHeaders['retry-after'], 10);
        } else if (error.data?.error?.message?.match(/retry after (\d+)/i)) {
          const matchData = error.data.error.message.match(/retry after (\d+)/i);
          if (matchData && matchData[1]) {
            retryAfter = parseInt(matchData[1], 10);
          }
        }
        
        // Calculate delay with exponential backoff
        const delay = Math.max(1000 * Math.pow(2, retries), retryAfter * 1000);
        retries++;
        
        console.log(`[RL:${requestId}] Rate limited (${operationName}), retrying in ${delay/1000}s (attempt ${retries}/${maxRetries})`);
        
        // Wait for the delay period
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Reset our token counter to be safe
        this.resetTokenUsage();
      }
    }
  }
}; 