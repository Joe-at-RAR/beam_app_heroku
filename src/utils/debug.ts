/**
 * Debug utilities for troubleshooting server errors
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// For use in ESM environments
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_FILE = path.join(__dirname, '../../logs/error.log');

/**
 * Logs error details to console and a file for debugging
 * @param error The error object to log
 * @param context Additional context information
 */
export function debugError(error: any, context: Record<string, any> = {}) {
  // Create a timestamp
  const timestamp = new Date().toISOString();
  
  // Format the error information
  const errorInfo = {
    timestamp,
    message: error?.message || 'Unknown error',
    name: error?.name || 'Error',
    stack: error?.stack || 'No stack trace available',
    ...context
  };
  
  // Log to console with high visibility
  console.log(`\n=== CRITICAL ERROR DETAILS AT ${timestamp} ===`);
  console.log(`Error: ${errorInfo.name}: ${errorInfo.message}`);
  console.log(`Stack: ${errorInfo.stack}`);
  
  if (Object.keys(context).length > 0) {
    console.log(`Context: ${JSON.stringify(context, null, 2)}`);
  }
  
  // Ensure logs directory exists
  const logsDir = path.dirname(LOG_FILE);
  if (!fs.existsSync(logsDir)) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
    } catch (mkdirError) {
      console.log(`Failed to create logs directory: ${mkdirError}`);
      return;
    }
  }
  
  // Log to file
  try {
    fs.appendFileSync(
      LOG_FILE,
      `${JSON.stringify(errorInfo, null, 2)}\n---\n`,
      'utf8'
    );
    console.log(`Error details saved to ${LOG_FILE}`);
  } catch (fileError) {
    console.log(`Failed to write to error log file: ${fileError}`);
  }
}

/**
 * Request handler that captures and logs all error details
 * Use this middleware to diagnose 500 errors in specific routes
 */
export function errorDiagnostics(endpoint: string) {
  return async (req: any, _res: any, next: any) => {
    try {
      // Log the request
      console.log(`\n=== DIAGNOSTIC REQUEST TO ${endpoint} ===`);
      console.log(`Request URL: ${req.originalUrl}`);
      console.log(`Request Method: ${req.method}`);
      console.log(`Request Params: ${JSON.stringify(req.params)}`);
      console.log(`Request Query: ${JSON.stringify(req.query)}`);
      console.log(`Request Headers: ${JSON.stringify(req.headers)}`);
      
      // Pass to next middleware
      next();
    } catch (error) {
      // Log diagnostic information
      debugError(error, {
        endpoint,
        method: req.method,
        url: req.originalUrl,
        params: req.params,
        query: req.query,
        headers: req.headers
      });
      
      // Pass to error handler
      next(error);
    }
  };
}

// Middleware to log all headers
export function logAllHeadersMiddleware() {
  return async (req: any, _res: any, next: any) => {
    console.log('Headers:', req.headers);
    next();
  };
} 