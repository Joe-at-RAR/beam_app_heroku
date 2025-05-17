import { Socket } from 'socket.io';
import { SocketError } from '../types/socket';

/**
 * Error codes for socket errors
 */
export enum SocketErrorCode {
  // Authentication errors
  AUTH_MISSING_TOKEN = 'AUTH_MISSING_TOKEN',
  AUTH_INVALID_TOKEN = 'AUTH_INVALID_TOKEN',
  AUTH_EXPIRED = 'AUTH_EXPIRED',
  AUTH_INSUFFICIENT_PERMISSIONS = 'AUTH_INSUFFICIENT_PERMISSIONS',

  // Room errors
  ROOM_ACCESS_DENIED = 'ROOM_ACCESS_DENIED',
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_JOIN_FAILED = 'ROOM_JOIN_FAILED',

  // Rate limiting errors
  RATE_LIMIT_CONNECTIONS = 'RATE_LIMIT_CONNECTIONS',
  RATE_LIMIT_EVENTS = 'RATE_LIMIT_EVENTS',

  // Connection errors
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  CONNECTION_TIMEOUT = 'CONNECTION_TIMEOUT',
  CONNECTION_CLOSED = 'CONNECTION_CLOSED',

  // Event errors
  EVENT_VALIDATION_FAILED = 'EVENT_VALIDATION_FAILED',
  EVENT_HANDLER_ERROR = 'EVENT_HANDLER_ERROR',
  EVENT_TIMEOUT = 'EVENT_TIMEOUT',

  // Server errors
  SERVER_ERROR = 'SERVER_ERROR',
  INTERNAL_ERROR = 'INTERNAL_ERROR'
}

/**
 * Error messages for socket errors
 */
export const ErrorMessages: Record<SocketErrorCode, string> = {
  [SocketErrorCode.AUTH_MISSING_TOKEN]: 'Authentication token is missing',
  [SocketErrorCode.AUTH_INVALID_TOKEN]: 'Invalid authentication token',
  [SocketErrorCode.AUTH_EXPIRED]: 'Authentication token has expired',
  [SocketErrorCode.AUTH_INSUFFICIENT_PERMISSIONS]: 'Insufficient permissions',
  [SocketErrorCode.ROOM_ACCESS_DENIED]: 'Access to room denied',
  [SocketErrorCode.ROOM_NOT_FOUND]: 'Room not found',
  [SocketErrorCode.ROOM_JOIN_FAILED]: 'Failed to join room',
  [SocketErrorCode.RATE_LIMIT_CONNECTIONS]: 'Too many connections',
  [SocketErrorCode.RATE_LIMIT_EVENTS]: 'Too many events',
  [SocketErrorCode.CONNECTION_ERROR]: 'Connection error occurred',
  [SocketErrorCode.CONNECTION_TIMEOUT]: 'Connection timed out',
  [SocketErrorCode.CONNECTION_CLOSED]: 'Connection closed unexpectedly',
  [SocketErrorCode.EVENT_VALIDATION_FAILED]: 'Event validation failed',
  [SocketErrorCode.EVENT_HANDLER_ERROR]: 'Error handling event',
  [SocketErrorCode.EVENT_TIMEOUT]: 'Event timed out',
  [SocketErrorCode.SERVER_ERROR]: 'Server error occurred',
  [SocketErrorCode.INTERNAL_ERROR]: 'Internal server error'
};

/**
 * Creates a socket error with the given code and optional details
 */
export function createSocketError(code: SocketErrorCode, details?: unknown): SocketError {
  const error = new Error(ErrorMessages[code]) as SocketError;
  error.code = code;
  error.data = details;
  return error;
}

/**
 * Error handler middleware for socket events
 */
export function errorHandler(socket: Socket) {
  return (err: Error | SocketError, next: (err?: Error) => void) => {
    // Convert regular Error to SocketError if needed
    const socketError = isSocketError(err)
      ? err
      : createSocketError(SocketErrorCode.INTERNAL_ERROR, {
          originalError: err.message,
          stack: err.stack
        });

    // Log the error
    console.log('Socket error:', {
      socketId: socket.id,
      code: socketError.code,
      message: socketError.message,
      data: socketError.data,
      stack: socketError.stack
    });

    // Emit error event to client
    socket.emit('error', {
      code: socketError.code,
      message: socketError.message,
      ...(process.env['NODE_ENV'] === 'development' && { data: socketError.data })
    });

    // Continue with error for other middleware
    next(socketError);
  };
}

/**
 * Type guard for SocketError
 */
function isSocketError(error: Error | SocketError): error is SocketError {
  return 'code' in error;
}

/**
 * Error boundary middleware for socket events
 */
export function errorBoundary(socket: Socket) {
  return async (packet: unknown[], next: (err?: Error) => void) => {
    try {
      // Validate packet structure
      if (!Array.isArray(packet) || packet.length === 0) {
        throw createSocketError(SocketErrorCode.EVENT_VALIDATION_FAILED, {
          reason: 'Invalid packet structure'
        });
      }

      const [event] = packet;

      // Basic event validation
      if (typeof event !== 'string') {
        throw createSocketError(SocketErrorCode.EVENT_VALIDATION_FAILED, {
          reason: 'Event name must be a string'
        });
      }

      // Add timeout for event handling
      const timeout = setTimeout(() => {
        next(createSocketError(SocketErrorCode.EVENT_TIMEOUT, { event }));
      }, 30000); // 30 second timeout

      try {
        // Execute next middleware/handler
        await next();
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      // Handle any errors that occur during event processing
      errorHandler(socket)(err as Error, next);
    }
  };
}

/**
 * Recovery middleware for handling disconnections
 */
export function recoveryHandler(socket: Socket) {
  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected:', {
      socketId: socket.id,
      reason
    });

    // Emit disconnect event to client with reason
    socket.emit('disconnect_info', {
      code: SocketErrorCode.CONNECTION_CLOSED,
      message: `Connection closed: ${reason}`,
      reason
    });
  });

  socket.on('error', (error: Error) => {
    console.log('Socket error:', {
      socketId: socket.id,
      error
    });

    // Convert to SocketError and emit
    const socketError = createSocketError(SocketErrorCode.CONNECTION_ERROR, {
      originalError: error.message
    });

    socket.emit('error', {
      code: socketError.code,
      message: socketError.message,
      ...(process.env['NODE_ENV'] === 'development' && { data: socketError.data })
    });
  });
}
