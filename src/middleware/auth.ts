import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';

const logger = createLogger('AUTH_MIDDLEWARE');

// Extend Express Request type to include user information
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
      };
    }
  }
}

/**
 * Middleware to enforce authentication via x-silknote-user-uuid header
 * This should be replaced with proper JWT/OAuth authentication in production
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userUuid = req.headers['x-silknote-user-uuid'] as string;
  
  if (!userUuid) {
    logger.warn(`Unauthorized request to ${req.method} ${req.path} - missing x-silknote-user-uuid header`);
    res.status(401).json({ 
      error: 'Authentication required',
      message: 'Missing x-silknote-user-uuid header'
    });
    return;
  }
  
  // Validate UUID format (basic check)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userUuid)) {
    logger.warn(`Invalid user UUID format: ${userUuid}`);
    res.status(401).json({ 
      error: 'Invalid authentication',
      message: 'Invalid x-silknote-user-uuid format'
    });
    return;
  }
  
  // Attach user to request
  req.user = { id: userUuid };
  
  logger.debug(`Authenticated request from user ${userUuid} to ${req.method} ${req.path}`);
  next();
}

/**
 * Helper function to extract user UUID from request
 * Throws error if not authenticated
 */
export function getUserUuid(req: Request): string {
  if (!req.user?.id) {
    throw new Error('User not authenticated');
  }
  return req.user.id;
}

/**
 * Middleware to validate patient UUID in params
 */
export function validatePatientUuid(req: Request, res: Response, next: NextFunction): void {
  const { silknotePatientUuid } = req.params;
  
  if (!silknotePatientUuid) {
    res.status(400).json({ 
      error: 'Invalid request',
      message: 'Missing patient UUID in request'
    });
    return;
  }
  
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(silknotePatientUuid)) {
    res.status(400).json({ 
      error: 'Invalid request',
      message: 'Invalid patient UUID format'
    });
    return;
  }
  
  next();
} 