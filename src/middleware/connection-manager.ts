import { Socket } from 'socket.io';
import { createSocketError, SocketErrorCode } from './error-handler';

interface ConnectionStats {
  connectTime: number;
  lastPingTime: number;
  pingCount: number;
  reconnectCount: number;
  messageQueue: QueuedMessage[];
  quality: ConnectionQuality;
}

interface QueuedMessage {
  event: string;
  data: unknown;
  timestamp: number;
  attempts: number;
}

enum ConnectionQuality {
  EXCELLENT = 'excellent',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor'
}

const stats = new Map<string, ConnectionStats>();
const MAX_QUEUE_SIZE = 1000;
const MAX_RETRY_ATTEMPTS = 3;
const QUALITY_THRESHOLDS = {
  EXCELLENT: 50,  // < 50ms latency
  GOOD: 100,      // < 100ms latency
  FAIR: 200       // < 200ms latency
  // > 200ms is POOR
};

/**
 * Connection manager middleware
 * Handles message queuing, reconnection, and connection quality monitoring
 */
export function connectionManager(socket: Socket) {
  // Initialize connection stats
  const initialStats: ConnectionStats = {
    connectTime: Date.now(),
    lastPingTime: Date.now(),
    pingCount: 0,
    reconnectCount: 0,
    messageQueue: [],
    quality: ConnectionQuality.GOOD
  };
  stats.set(socket.id, initialStats);

  // Set up heartbeat
  const heartbeatInterval = setInterval(() => {
    const start = Date.now();
    socket.emit('ping');
    
    socket.once('pong', () => {
      const latency = Date.now() - start;
      updateConnectionQuality(socket.id, latency);
    });

    const stat = stats.get(socket.id);
    if (stat) {
      stat.pingCount++;
      stat.lastPingTime = Date.now();
    }
  }, 5000);

  // Handle reconnection
  socket.on('reconnect', (attemptNumber: number) => {
    const stat = stats.get(socket.id);
    if (stat) {
      stat.reconnectCount++;
      processMessageQueue(socket);
    }
    console.log('Socket reconnected:', {
      socketId: socket.id,
      attemptNumber,
      totalReconnects: stat?.reconnectCount
    });
  });

  // Clean up on disconnect
  socket.on('disconnect', () => {
    clearInterval(heartbeatInterval);
  });

  return (packet: unknown[], next: (err?: Error) => void) => {
    try {
      const [event, ...args] = packet;
      
      // Add message to queue
      const stat = stats.get(socket.id);
      if (stat && !socket.connected) {
        if (stat.messageQueue.length >= MAX_QUEUE_SIZE) {
          throw createSocketError(SocketErrorCode.CONNECTION_ERROR, {
            reason: 'Message queue full'
          });
        }
        
        stat.messageQueue.push({
          event: event as string,
          data: args[0],
          timestamp: Date.now(),
          attempts: 0
        });
        return;
      }

      next();
    } catch (err) {
      next(err as Error);
    }
  };
}

/**
 * Update connection quality based on latency
 */
function updateConnectionQuality(socketId: string, latency: number) {
  const stat = stats.get(socketId);
  if (!stat) return;

  if (latency < QUALITY_THRESHOLDS.EXCELLENT) {
    stat.quality = ConnectionQuality.EXCELLENT;
  } else if (latency < QUALITY_THRESHOLDS.GOOD) {
    stat.quality = ConnectionQuality.GOOD;
  } else if (latency < QUALITY_THRESHOLDS.FAIR) {
    stat.quality = ConnectionQuality.FAIR;
  } else {
    stat.quality = ConnectionQuality.POOR;
  }
}

/**
 * Process queued messages after reconnection
 */
function processMessageQueue(socket: Socket) {
  const stat = stats.get(socket.id);
  if (!stat) return;

  const now = Date.now();
  const messages = [...stat.messageQueue];
  stat.messageQueue = [];

  for (const msg of messages) {
    if (msg.attempts >= MAX_RETRY_ATTEMPTS) {
      console.log('Message retry limit exceeded:', {
        socketId: socket.id,
        event: msg.event,
        attempts: msg.attempts
      });
      continue;
    }

    if (now - msg.timestamp > 450000) { // 5 minutes
      console.log('Message expired:', {
        socketId: socket.id,
        event: msg.event,
        age: now - msg.timestamp
      });
      continue;
    }

    msg.attempts++;
    socket.emit(msg.event, msg.data);
  }
}

/**
 * Get connection statistics
 */
export function getConnectionStats(socketId: string): ConnectionStats | undefined {
  return stats.get(socketId);
}

/**
 * Clear connection statistics
 */
export function clearConnectionStats(socketId: string): void {
  stats.delete(socketId);
}
