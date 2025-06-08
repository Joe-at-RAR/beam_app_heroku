import { Request, Response, NextFunction } from 'express';

// Extend Express Request type to include silknoteUserUuid
declare global {
  namespace Express {
    interface Request {
      silknoteUserUuid?: string;
    }
  }
}

/**
 * Simple middleware to extract silknoteUserUuid from headers
 * Auth is handled at a higher level before reaching the server
 */
export function extractHeaders(req: Request, res: Response, next: NextFunction) {
  // Extract silknoteUserUuid from headers
  const silknoteUserUuid = req.headers['x-silknote-user-uuid'] as string;
  
  if (silknoteUserUuid) {
    req.silknoteUserUuid = silknoteUserUuid;
  }
  
  console.log(`[MIDDLEWARE] Extracted silknoteUserUuid: ${silknoteUserUuid}`);
  
  next();
}

/**
 * Get silknoteUserUuid from request (either from middleware or headers)
 */
export function getSilknoteUserUuid(req: Request): string {
  // First try from middleware
  if (req.silknoteUserUuid) {
    return req.silknoteUserUuid;
  }
  
  // Fallback to direct header extraction
  const silknoteUserUuid = req.headers['x-silknote-user-uuid'] as string;
  if (!silknoteUserUuid) {
    throw new Error('Missing required header: x-silknote-user-uuid');
  }
  
  return silknoteUserUuid;
}

// Legacy compatibility - this should be replaced everywhere
export function getUserUuid(req: Request): string {
  return getSilknoteUserUuid(req);
}

// Legacy compatibility
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  extractHeaders(req, res, next);
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