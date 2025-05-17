/**
 * Enhanced Token Rate Limiter for OpenAI API
 * Provides robust rate limiting with exponential backoff, better concurrency handling,
 * and more concise error logging
 */

// Constants for rate limiting
const MAX_TOKENS_PER_MINUTE = 450000; // Azure OpenAI S0 tier limit
const DEFAULT_BACKOFF_MS = 1000; // Start with 1 second backoff
const MAX_BACKOFF_MS = 128000; // Cap backoff at 32 seconds
const TOKEN_SAFETY_MARGIN = 0.95; // Use 95% of limit for safety

// Exponential backoff calculator
function calculateBackoff(attempt: number): number {
  return Math.min(
    DEFAULT_BACKOFF_MS * Math.pow(2, attempt),
    MAX_BACKOFF_MS
  );
}

// Enhanced singleton rate limiter with better concurrency handling
export const tokenRateLimiter = {
  tokensUsed: 0,
  lastResetTime: Date.now(),
  pendingRequests: 0, // Track concurrent requests
  backoffAttempt: 0, // Track consecutive rate limit hits
  
  // Track token usage and wait if needed - with improved concurrency handling
  async trackTokens(tokenCount: number): Promise<void> {
    const now = Date.now();
    this.pendingRequests++;
    
    try {
      // Reset counter if it's been more than a minute
      if (now - this.lastResetTime >= 60000) {
        // Only log if we actually used tokens
        if (this.tokensUsed > 1000) {
          console.log(`[RL] Reset: ${this.tokensUsed} tokens/min`);
        }
        this.tokensUsed = 0;
        this.lastResetTime = now;
        this.backoffAttempt = 0; // Reset backoff counter on successful reset
      }
      
      // Calculate safe token limit with our concurrent requests in mind
      const safeLimit = MAX_TOKENS_PER_MINUTE * TOKEN_SAFETY_MARGIN;
      const adjustedLimit = Math.floor(safeLimit / Math.max(1, this.pendingRequests));
      
      // If adding these tokens would exceed our limit, wait with exponential backoff
      if (this.tokensUsed + tokenCount > adjustedLimit) {
        // Calculate time to wait with exponential backoff
        const timeToWait = Math.max(
          calculateBackoff(this.backoffAttempt),
          60000 - (now - this.lastResetTime) 
        );
        
        console.log(`[RL] Limit reached: waiting ${(timeToWait/1000).toFixed(1)}s (attempt ${this.backoffAttempt+1})`);
        this.backoffAttempt++; // Increment backoff counter
        
        await new Promise(resolve => setTimeout(resolve, timeToWait));
        
        // After waiting, reset counter and try again
        this.tokensUsed = 0;
        this.lastResetTime = Date.now();
      } else {
        // If we successfully ran without hitting limits, gradually reduce backoff
        if (this.backoffAttempt > 0) this.backoffAttempt--;
      }
      
      // Add tokens to the count
      this.tokensUsed += tokenCount;
      

    } finally {
      this.pendingRequests--; // Always decrement, even on error
    }
  },
  
  // Get current token usage as percentage of limit
  getUsagePercentage(): number {
    return (this.tokensUsed / MAX_TOKENS_PER_MINUTE) * 100;
  },
  
  // Improved token estimation based on OpenAI's guidance
  estimateTokens(text: string): number {
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
  
  // Helper method to handle rate limit errors and retry with exponential backoff
  async handleRateLimitError(error: any): Promise<void> {
    // Check if this is a rate limit error
    if (error.statusCode === 429 || (error.data && error.data.error && error.data.error.code === '429')) {
      // Extract retry-after time if available
      let retryAfter = 1; // Default to 1 second
      
      if (error.responseHeaders?.['retry-after']) {
        retryAfter = parseInt(error.responseHeaders['retry-after']);
      } else if (error.data?.error?.message) {
        // Try to extract from error message - "Please retry after 33 seconds"
        const match = error.data.error.message.match(/retry after (\d+) seconds/i);
        if (match && match[1]) {
          retryAfter = parseInt(match[1]);
        }
      }
      
      // Use the larger of retry-after or our calculated backoff
      const backoffTime = Math.max(
        retryAfter * 1000,
        calculateBackoff(this.backoffAttempt)
      );
      
      //console.log(`[RL] Rate limit hit: waiting ${(backoffTime/1000).toFixed(1)}s`);
      this.backoffAttempt++; // Increment backoff counter
      
      // Wait for the specified time
      await new Promise(resolve => setTimeout(resolve, backoffTime));
      
      // Reset tokens after waiting
      this.tokensUsed = 0;
      this.lastResetTime = Date.now();
      return;
    }
    
    // If not a rate limit error, rethrow
    throw error;
  }
}; 