/**
 * Server Entry Point
 * 
 * This file sets up our Express server with:
 * - File upload handling (Multer)
 * - Rate limiting
 * - CORS
 * - Request validation (Zod)
 * - Error handling
 * - API routes
 */

import express, { type Application, type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import multer from 'multer';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { z } from 'zod';
import http from 'http';
import { initSocket } from './socket';
import queryRouter from './routes/query.js';
import config from './config.js';
import { storageService } from './utils/storage';
import caseSummaryRouter from './routes/caseSummary';
import patientRoutes from './routes/patient.routes';
import userRoutes from './routes/user.routes';
import documentsRouter from './routes/documents';
import documentReprocessRouter from './routes/document-reprocess';
import vectorSearchRouter from './routes/vectorSearch';
import documentAlertsRouter from './routes/documentAlerts';
import { getPatientById } from './services/patientService';
import { requireAuth } from './middleware/auth';

////////////////////////////////////////////////////////////////
// Express App Configuration
////////////////////////////////////////////////////////////////

const app: Application = express();

// Basic middleware
app.use(cors({
  origin: config.server.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Debug-Info', 'X-Client-Timestamp', 'x-silknote-user-uuid', 'x-silknote-patient-uuid']
}));

// Log CORS configuration for debugging
console.log('CORS Configuration:', {
  origin: Array.isArray(config.server.corsOrigin) 
    ? config.server.corsOrigin.join(', ') 
    : config.server.corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// Add direct request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n=== ${timestamp} - ${req.method} ${req.originalUrl || req.url} ===`);
  
  // Create response logger
  const oldSend = res.send;
  res.send = function(data) {
    const responseTimestamp = new Date().toISOString();
    const statusCode = res.statusCode;
    console.log(`\n=== ${responseTimestamp} - RESPONSE ${statusCode} for ${req.method} ${req.originalUrl || req.url} ===`);
    if (statusCode >= 400) {
      console.error(`ERROR ${statusCode} on ${req.method} ${req.originalUrl || req.url}`);
      if (data && typeof data === 'string' && data.length < 1000) {
        console.error(`Response body: ${data}`);
      }
    }
    return oldSend.call(res, data);
  };
  
  next();
});

console.log = function(...args) {
  process.stdout.write(args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2).substring(0,200) : arg
  ).join(' ') + '\n');
};

console.error = function(...args) {
  process.stderr.write('\x1b[31m' + args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
  ).join(' ') + '\x1b[0m\n');
};

console.warn = function(...args) {
  process.stdout.write('\x1b[33m' + args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
  ).join(' ') + '\x1b[0m\n');
};

console.info = function(...args) {
  process.stdout.write('\x1b[36m' + args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
  ).join(' ') + '\x1b[0m\n');
};

console.debug = function(...args) {
  process.stdout.write('\x1b[90m' + args.map(arg => 
    typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
  ).join(' ') + '\x1b[0m\n');
};

app.use(express.json({
  verify: (req: any, _res, buf, _encoding) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      console.error(`[${new Date().toISOString()}] [JSON PARSE ERROR] Failed to parse request body:`, {
        url: req.originalUrl || req.url,
        method: req.method,
        error: e instanceof Error ? e.message : String(e),
        body: buf.toString().substring(0, 200) + '...'
      });
      
      // We don't throw here to allow the error to propagate to the normal error handlers
    }
  }
}));

////////////////////////////////////////////////////////////////
// Rate Limiting
////////////////////////////////////////////////////////////////

const rateLimiter = new RateLimiterMemory({
  points: 10,    // Number of requests
  duration: 1    // Per second
});

// Apply rate limiting to all requests
app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clientIp = req.ip || '0.0.0.0';
    await rateLimiter.consume(clientIp);
    next();
  } catch {
    res.status(429).json({ error: 'Too many requests' });
  }
});

////////////////////////////////////////////////////////////////
// Error Handling Middleware
////////////////////////////////////////////////////////////////

// Handle Multer-specific errors
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    // File size exceeded
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 10MB per file.'
      });
    }
    // Too many files
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files. Maximum is 500 files per upload.'
      });
    }
    // Other Multer errors
    return res.status(400).json({
      success: false,
      error: `Upload error: ${err.message}`
    });
  }
  // Invalid file type errors
  if (err.message.includes('Invalid file type')) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
  return next(err); // Add return statement
});

// Handle validation errors
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof z.ZodError) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.errors
    });
  }
  return next(err); // Add return statement
});

// Add a global error handler to log unhandled errors
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [GLOBAL ERROR HANDLER] Unhandled server error:`, {
    message: err.message,
    stack: err.stack,
    name: err.name,
    code: err.code,
    method: req.method,
    url: req.originalUrl,
    params: req.params,
    query: req.query,
    body: req.body ? JSON.stringify(req.body).substring(0, 1000) : undefined,
    headers: req.headers
  });
  
  // Log more details about the error object itself
  console.error(`[${timestamp}] [GLOBAL ERROR HANDLER] Error object inspection:`, {
    errorType: typeof err,
    errorConstructor: err && err.constructor ? err.constructor.name : 'unknown',
    errorKeys: err ? Object.keys(err) : [],
    errorIsError: err instanceof Error,
    errorToString: err ? err.toString() : 'null or undefined error'
  });
  
  // Send a specific JSON response for 500 errors
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message || 'An unexpected error occurred',
    timestamp,
    path: req.originalUrl
  });
});

////////////////////////////////////////////////////////////////
// Routes
////////////////////////////////////////////////////////////////

// Root endpoint for health or basic info
app.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'API root - use /api/* or /health' })
})

// Health check endpoint (no auth required)
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// Apply authentication middleware to all /api routes EXCEPT administrative endpoints
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  // List of endpoints that don't require authentication
  const publicEndpoints = [
    '/api/documents/reprocess', // Administrative endpoint
    '/api/users' // User registration
  ];
  
  // Check if the current path is a public endpoint
  const isPublicEndpoint = publicEndpoints.some(endpoint => 
    req.path === endpoint || req.path.startsWith(endpoint + '/')
  );
  
  if (isPublicEndpoint) {
    // Skip authentication for public endpoints
    return next();
  }
  
  // Apply authentication for all other endpoints
  return requireAuth(req, res, next);
});

// API endpoints (authentication applied selectively above)
app.use('/api/query', queryRouter);
app.use('/api/patients', patientRoutes);
app.use('/api/users', userRoutes);
app.use('/api/case-summary', caseSummaryRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/documents', documentReprocessRouter); // Add reprocess endpoint
app.use('/api/vector-search', vectorSearchRouter);
app.use('/api/alerts', documentAlertsRouter);

app.get('/api/patients/:silknotePatientUuid/case-summary', async (req, res) => {
  const { silknotePatientUuid } = req.params;
  
  console.log(`=== ${new Date().toISOString()} - GET /api/patients/${silknotePatientUuid}/case-summary ===`);
  
  // Forward the request to our case-summary handler
  res.redirect(`/api/case-summary/patients/${silknotePatientUuid}/case-summary`);
});

////////////////////////////////////////////////////////////////
// Server Initialization
////////////////////////////////////////////////////////////////

async function recoverPendingDocuments() {
  console.info('[SERVER RECOVERY] Document recovery is disabled during migration to user-scoped storage')
  // TODO: Implement cross-user recovery mechanism if needed
  // For now, skip recovery to avoid function signature mismatches
  return
}

const initializeServer = async () => {
  try {
    // Initialize storage service (this initializes the database adapter)
    const storageInit = await storageService.initialize();
    if (!storageInit.success) {
      console.error('Storage initialization failed:', storageInit.errors);
      process.exit(1);
    }
    
    // Create HTTP server
    const server = http.createServer(app);
    
    // Initialize Socket.IO
    initSocket(server);

    // Perform recovery of any in-flight documents
    await recoverPendingDocuments();

    // Start the server
    const port = process.env['PORT'] || config.server.port;
    server.listen(port, () => {
      console.log(`Server running on port ${port}`);
      console.log(`Environment: ${config.server.nodeEnv}`);
      if (config.server.isDevelopment) {
        console.log(`CORS enabled for: ${config.server.corsOrigin}`);
        console.log(`Public base URL: ${config.server.publicBaseUrl}`);
        console.log(`WebSocket base URL: ${config.server.wsBaseUrl}`);
      }
      
      // Log all registered routes for debugging
      console.log('---------------------- REGISTERED ROUTES ----------------------');
      function printRoutes(stack: any[], basePath = '') {
        stack.forEach(r => {
          if (r.route) {
            const methods = Object.keys(r.route.methods).map(m => m.toUpperCase()).join(',');
            console.log(`${methods} ${basePath}${r.route.path}`);
          } else if (r.name === 'router' && r.handle.stack) {
            const routerPath = r.regexp.toString().replace('\\/?(?=\\/|$)', '').replace(/^\\\\/, '').replace(/\\\\/g, '/').replace('(?:\\/)?$', '');
            const path = routerPath.replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, ':param');
            const routerBasePath = basePath + (path === '/' ? '' : path);
            printRoutes(r.handle.stack, routerBasePath);
          }
        });
      }

      try {
        printRoutes(app._router.stack);
        console.log('--------------------------------------------------------------');
      } catch (e) {
        console.error('Failed to print routes:', e);
      }
    });

  } catch (error) {
    console.error('Server initialization failed:', error);
    process.exit(1);
  }
};

// Start server with error handling
initializeServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

// Add process-level error handlers 
process.on('uncaughtException', (error) => {
  console.error(`[${new Date().toISOString()}] [UNCAUGHT EXCEPTION] Critical error:`, {
    message: error.message,
    stack: error.stack,
    name: error.name
  });
  
  // Don't exit the process in development to allow for debugging
  if (process.env['NODE_ENV'] !== 'development') {
    console.error('Process will exit due to uncaught exception');
    process.exit(1);
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${new Date().toISOString()}] [UNHANDLED REJECTION] Unhandled promise rejection:`, {
    reason: reason instanceof Error ? { 
      message: reason.message, 
      stack: reason.stack,
      name: reason.name 
    } : reason,
    promise
  });
});

export default app;
