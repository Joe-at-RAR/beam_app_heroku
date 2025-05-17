import { Socket, DisconnectReason } from 'socket.io';

/**
 * Extended Socket interface with user authentication data
 */
export interface AuthenticatedSocket extends Socket {
  user?: {
    id: string;
    role: string;
  };
}

/**
 * Generic type for socket event data
 */
export interface SocketEventData {
  [key: string]: unknown;
}

/**
 * Type for socket middleware next function
 */
export interface SocketMiddlewareNext {
  (err?: Error): void;
}

/**
 * Re-export Socket.IO's DisconnectReason type
 */
export type SocketDisconnectReason = DisconnectReason;

/**
 * Extended error interface for socket errors
 */
export interface SocketError extends Error {
  code?: string;
  data?: unknown;
}
