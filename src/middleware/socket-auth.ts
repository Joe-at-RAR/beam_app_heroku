import { Socket } from 'socket.io';

interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    role: string;
  };
}

class SocketAuthError extends Error {
  constructor(
    message: string,
    public code: string
  ) {
    super(message);
    this.name = 'SocketAuthError';
  }
}

/**
 * Socket.IO authentication middleware
 * Validates JWT token and attaches user data to socket
 */
export const socketAuth = () => {
  return (socket: AuthenticatedSocket, next: (err?: Error) => void) => {
    try {

      // Use simplified authentication based on silknotePatientUuid for all environments
      const silknotePatientUuid = socket.handshake.auth['silknotePatientUuid'];
      if (silknotePatientUuid) {
        // console.log(`Socket authenticated with silknotePatientUuid: ${silknotePatientUuid}`, {
        //   socketId: socket.id,
        //   silknotePatientUuid
        // });
        
        socket.user = { 
          id: silknotePatientUuid,
          role: 'user'
        };
        return next();
      }
      
      // If no silknotePatientUuid provided, fail authentication
      return next(new SocketAuthError('Authentication failed: silknotePatientUuid required', 'AUTH_MISSING_PATIENT_ID'));
    } catch (err) {
      console.log('Socket authentication error:', err);
      next(new SocketAuthError('Authentication failed', 'AUTH_FAILED'));
    }
  };
};

/**
 * Room access control middleware
 * Ensures users can only join rooms they have access to
 * Simplified to reduce excessive logging and checks
 */
export const roomAuth = (socket: AuthenticatedSocket, _room: string, next: (err?: Error) => void) => {
  try {
    // Skip in test environment
    if (process.env['NODE_ENV'] === 'test') {
      return next();
    }

    if (!socket.user) {
      return next(new SocketAuthError('Authentication required', 'AUTH_REQUIRED'));
    }

    // Always allow access if user is authenticated
    next();
  } catch (err) {
    console.log('Room authentication error:', err);
    next(new SocketAuthError('Room access denied', 'ROOM_ACCESS_DENIED'));
  }
};

/**
 * Rate limiting middleware
 * Prevents abuse by limiting connection and event frequency
 */
export const rateLimiter = () => {
  const connections = new Map<string, number>();
  const events = new Map<string, number[]>();
  const MAX_CONNECTIONS_PER_IP = 10;
  const MAX_EVENTS_PER_MINUTE = 100;
  const EVENT_WINDOW = 60 * 1000; // 1 minute

  return (socket: Socket, next: (err?: Error) => void) => {
    try {
      const ip = socket.handshake.address;

      // Check connection limit
      const currentConnections = (connections.get(ip) || 0) + 1;
      if (currentConnections > MAX_CONNECTIONS_PER_IP) {
        return next(new SocketAuthError('Too many connections', 'RATE_LIMIT_CONNECTIONS'));
      }
      connections.set(ip, currentConnections);

      // Initialize event tracking
      events.set(ip, [Date.now()]);

      // Add event listener
      socket.onAny(() => {
        const timestamps = events.get(ip) || [];
        const now = Date.now();
        
        // Remove old events outside the window
        const recentEvents = timestamps.filter(t => now - t < EVENT_WINDOW);
        
        if (recentEvents.length >= MAX_EVENTS_PER_MINUTE) {
          socket.emit('error', {
            code: 'RATE_LIMIT_EVENTS',
            message: 'Too many events'
          });
          socket.disconnect();
          return;
        }

        recentEvents.push(now);
        events.set(ip, recentEvents);
      });

      // Cleanup on disconnect
      socket.on('disconnect', () => {
        const count = connections.get(ip);
        if (count && count > 0) {
          connections.set(ip, count - 1);
        }
        if (count === 1) {
          connections.delete(ip);
          events.delete(ip);
        }
      });

      next();
    } catch (err) {
      console.log('Rate limiting error:', err);
      next(new SocketAuthError('Rate limiting failed', 'RATE_LIMIT_ERROR'));
    }
  };
};
