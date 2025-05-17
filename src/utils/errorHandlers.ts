import { Request, Response, NextFunction } from 'express';

/**
 * Utility function to properly handle async route errors in Express
 * Ensures errors in async route handlers are properly propagated to Express error handlers
 */
export const asyncHandler = (fn: Function) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res, next)).catch(next);
}; 