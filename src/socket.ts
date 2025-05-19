import { Server } from 'socket.io';
import http from 'http';
import { socketAuth, roomAuth, rateLimiter } from './middleware/socket-auth';
import { 
  AuthenticatedSocket, 
  SocketMiddlewareNext,
  SocketDisconnectReason,
  SocketError 
} from './types/socket';
import {
  ServerToClientEvents,
  ClientToServerEvents,
  SocketData
} from './types/events';
import { io, setIo } from './utils/io';
import config from './config';
import { createLogger } from './utils/logger'

const logger = createLogger('SOCKETS')

export { io };

export function initSocket(server: http.Server) {
  logger.info('Attempting to initialize Socket.IO server...');
  logger.info('Initializing Socket.IO server:', {
    environment: config.server.nodeEnv,
    corsOrigin: Array.isArray(config.server.corsOrigin) 
      ? config.server.corsOrigin.join(', ') 
      : config.server.corsOrigin,
    publicBaseUrl: config.server.publicBaseUrl,
    wsBaseUrl: config.server.wsBaseUrl,
    transports: ['websocket', 'polling']
  });

  const socketServer = new Server<ClientToServerEvents, ServerToClientEvents, never, SocketData>(server, {
    cors: {
      origin: config.server.corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
      allowedHeaders: ['Authorization']
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 20000,
    pingInterval: 10000,
    path: '/socket.io',
    allowEIO3: true,
    connectTimeout: 45000
  });

  // Set the global io instance
  setIo(socketServer);

  // Apply global middlewares in order
  socketServer.use(rateLimiter());
  socketServer.use(socketAuth());
  
  // Listen for client connections and handle joining rooms
  socketServer.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`New client connected: ${socket.id}`);

    // Apply room authentication middleware
    socket.use(([event, ...args]: [string, ...any[]], next: SocketMiddlewareNext) => {
      if (event === 'joinPatientRoom') {
        roomAuth(socket, `patient-${args[0]}`, next);
      } else {
        next();
      }
    });

    socket.on('joinPatientRoom', async (silknotePatientUuid: string, callback?: (response: any) => void) => {
      try {
        const roomId = `patient-${silknotePatientUuid}`;
        
        // Check if socket is already in this room to prevent redundant joins
        if (socket.rooms.has(roomId)) {
          logger.appDebug(`Socket ${socket.id} already in room ${roomId}, skipping join`);
          
          // Send successful response if callback exists
          if (typeof callback === 'function') {
            callback({ status: 'ok', roomId, alreadyJoined: true });
          }
          return;
        }
        
    // Only log minimal information
    logger.info(`Socket ${socket.id} joining room ${roomId}`);
    
    await socket.join(roomId);
    
    // Log socket rooms after join for debugging
    logger.appDebug(`[SOCKET] After join: Socket ${socket.id} is in rooms:`, Array.from(socket.rooms));
    logger.appDebug(`[SOCKET] Room ${roomId} now has ${io.sockets.adapter.rooms.get(roomId)?.size || 0} clients`);
    
    // Send successful response if callback exists
    if (typeof callback === 'function') {
      callback({ status: 'ok', roomId });
    }
      } catch (error) {
        logger.error('Error joining patient room:', {
          socketId: socket.id,
          silknotePatientUuid,
          error
        });
        
        // Send error response if callback exists
        if (typeof callback === 'function') {
          try {
            callback({ status: 'error', message: 'Failed to join room' });
          } catch (callbackError) {
            logger.error('Error executing joinPatientRoom error callback:', {
              socketId: socket.id,
              error: callbackError
            });
          }
        }
      }
    });

    socket.on('disconnect', (reason: SocketDisconnectReason) => {
      logger.info('Client disconnected:', {
        socketId: socket.id,
        reason
      });
    });

    socket.on('error', (error: SocketError) => {
      logger.error('Socket error:', {
        socketId: socket.id,
        error
      });
    });
  });

  return socketServer;
}
