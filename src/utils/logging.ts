/**
 * Logging utility functions for consistent log formatting across the application
 */

/**
 * Log an informational message
 * @param message The message to log
 * @param data Optional data to include with the log
 */
export function logInfo(message: string, data?: any): void {
  console.log(`[INFO] ${new Date().toISOString()} - ${message}`, data || '');
}

/**
 * Log a debug message
 * @param message The message to log
 * @param data Optional data to include with the log
 */
export function logDebug(message: string, data?: any): void {
  console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, data || '');
}

/**
 * Log a warning message
 * @param message The message to log
 * @param data Optional data to include with the log
 */
export function logWarning(message: string, data?: any): void {
  console.log(`[WARN] ${new Date().toISOString()} - ${message}`, data || '');
}

/**
 * Log an error message
 * @param message The message to log
 * @param error Optional error object to include
 */
export function logError(message: string, error?: Error): void {
  console.log(`[ERROR] ${new Date().toISOString()} - ${message}`, error || '');
  
  // Optionally add stack trace if error is provided
  if (error && error.stack) {
    console.log(`[ERROR STACK] ${error.stack}`);
  }
}

/**
 * Log a critical error message
 * @param message The message to log
 * @param error Optional error object to include
 */
export function logCritical(message: string, error?: Error): void {
  console.log(`[CRITICAL] ${new Date().toISOString()} - ${message}`, error || '');
  
  // Always add stack trace for critical errors
  if (error && error.stack) {
    console.log(`[CRITICAL STACK] ${error.stack}`);
  }
}

/**
 * Create a scoped log method with a specific prefix
 * @param scope The scope to prefix all logs with
 */
export function createScopedLogger(scope: string) {
  return {
    info: (message: string, data?: any) => logInfo(`[${scope}] ${message}`, data),
    debug: (message: string, data?: any) => logDebug(`[${scope}] ${message}`, data),
    warning: (message: string, data?: any) => logWarning(`[${scope}] ${message}`, data),
    error: (message: string, error?: Error) => logError(`[${scope}] ${message}`, error),
    critical: (message: string, error?: Error) => logCritical(`[${scope}] ${message}`, error),
  };
} 