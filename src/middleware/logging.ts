import { Request, Response, NextFunction } from 'express';

function truncateForLogging(obj: any, maxLength: number = 100): any {
  if (typeof obj === 'string') {
    return obj.length > maxLength ? `${obj.substring(0, maxLength)}...` : obj;
  }
  if (Array.isArray(obj)) {
    return obj.length > 10 ? 
      `[${obj.length} items, showing first 3]: ${JSON.stringify(obj.slice(0, 3))}...` : 
      obj;
  }
  if (typeof obj === 'object' && obj !== null) {
    const truncated: any = {};
    Object.entries(obj).forEach(([key, value]) => {
      if (key === 'buffer' || key === 'data' || key === 'content') {
        truncated[key] = '[Content truncated for logging]';
      } else {
        truncated[key] = truncateForLogging(value, maxLength);
      }
    });
    return truncated;
  }
  return obj;
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const originalSend = res.send;
  const originalJson = res.json;

  // Log request
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (Object.keys(req.query).length > 0) {
    console.log('Query:', truncateForLogging(req.query));
  }
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Body:', truncateForLogging(req.body));
  }

  // Override send to log response
  res.send = function (body: any): Response {
    console.log(`[${new Date().toISOString()}] Response ${req.method} ${req.url} (${Date.now() - start}ms):`, truncateForLogging(body));
    return originalSend.call(this, body);
  };

  // Override json to log response
  res.json = function (body: any): Response {
    console.log(`[${new Date().toISOString()}] Response ${req.method} ${req.url} (${Date.now() - start}ms):`, truncateForLogging(body));
    return originalJson.call(this, body);
  };

  next();
}
