import { Socket } from 'socket.io';

interface RoomStats {
  members: Set<string>;
  createdAt: number;
  lastActivity: number;
  activityLog: RoomActivity[];
}

interface RoomActivity {
  type: RoomActivityType;
  socketId: string;
  silknoteUserUuid?: string;
  timestamp: number;
  details?: unknown;
}

enum RoomActivityType {
  JOIN = 'join',
  LEAVE = 'leave',
  MESSAGE = 'message',
  ERROR = 'error'
}

const roomStats = new Map<string, RoomStats>();
const ROOM_CLEANUP_INTERVAL = 3600000; // 1 hour
const ROOM_ACTIVITY_LIMIT = 1000; // Keep last 1000 activities
const INACTIVE_ROOM_THRESHOLD = 86400000; // 24 hours

/**
 * Room manager middleware
 * Handles room state persistence, cleanup, and activity monitoring
 */
export function roomManager(socket: Socket) {
  // Initialize room cleanup interval
  const cleanupInterval = setInterval(() => {
    cleanupInactiveRooms();
  }, ROOM_CLEANUP_INTERVAL);

  // Clean up on disconnect
  socket.on('disconnect', () => {
    clearInterval(cleanupInterval);
    removeFromAllRooms(socket);
  });

  return async (packet: unknown[], next: (err?: Error) => void) => {
    try {
      const [event, ...args] = packet;

      // Handle room-related events
      if (event === 'joinPatientRoom') {
        const roomId = `patient-${args[0]}`;
        await handleRoomJoin(socket, roomId);
      } else if (event === 'leavePatientRoom') {
        const roomId = `patient-${args[0]}`;
        handleRoomLeave(socket, roomId);
      }

      // Log room activity for all events
      socket.rooms.forEach(room => {
        if (room !== socket.id) { // Skip socket's own room
          logRoomActivity(room, {
            type: RoomActivityType.MESSAGE,
            socketId: socket.id,
            silknoteUserUuid: (socket as any).user?.id,
            timestamp: Date.now(),
            details: { event, args }
          });
        }
      });

      next();
    } catch (err) {
      next(err as Error);
    }
  };
}

/**
 * Handle room join with validation
 */
async function handleRoomJoin(socket: Socket, roomId: string) {
  // Initialize room stats if needed
  if (!roomStats.has(roomId)) {
    roomStats.set(roomId, {
      members: new Set(),
      createdAt: Date.now(),
      lastActivity: Date.now(),
      activityLog: []
    });
  }

  const stats = roomStats.get(roomId)!;

  // Add member to room
  stats.members.add(socket.id);
  stats.lastActivity = Date.now();

  // Log join activity
  logRoomActivity(roomId, {
    type: RoomActivityType.JOIN,
    socketId: socket.id,
    silknoteUserUuid: (socket as any).user?.id,
    timestamp: Date.now()
  });

  // Emit room stats to all members
  socket.to(roomId).emit('roomUpdate', {
    roomId,
    memberCount: stats.members.size,
    lastActivity: stats.lastActivity
  });
}

/**
 * Handle room leave
 */
function handleRoomLeave(socket: Socket, roomId: string) {
  const stats = roomStats.get(roomId);
  if (!stats) return;

  // Remove member from room
  stats.members.delete(socket.id);
  stats.lastActivity = Date.now();

  // Log leave activity
  logRoomActivity(roomId, {
    type: RoomActivityType.LEAVE,
    socketId: socket.id,
    silknoteUserUuid: (socket as any).user?.id,
    timestamp: Date.now()
  });

  // Clean up empty rooms
  if (stats.members.size === 0) {
    roomStats.delete(roomId);
  } else {
    // Emit room stats to remaining members
    socket.to(roomId).emit('roomUpdate', {
      roomId,
      memberCount: stats.members.size,
      lastActivity: stats.lastActivity
    });
  }
}

/**
 * Log room activity with size limit
 */
function logRoomActivity(roomId: string, activity: RoomActivity) {
  const stats = roomStats.get(roomId);
  if (!stats) return;

  stats.activityLog.push(activity);
  if (stats.activityLog.length > ROOM_ACTIVITY_LIMIT) {
    stats.activityLog = stats.activityLog.slice(-ROOM_ACTIVITY_LIMIT);
  }
}

/**
 * Remove socket from all rooms
 */
function removeFromAllRooms(socket: Socket) {
  roomStats.forEach((stats, roomId) => {
    if (stats.members.has(socket.id)) {
      handleRoomLeave(socket, roomId);
    }
  });
}

/**
 * Clean up inactive rooms
 */
function cleanupInactiveRooms() {
  const now = Date.now();
  roomStats.forEach((stats, roomId) => {
    if (now - stats.lastActivity > INACTIVE_ROOM_THRESHOLD) {
      console.log('Cleaning up inactive room:', {
        roomId,
        age: now - stats.createdAt,
        inactivePeriod: now - stats.lastActivity
      });
      roomStats.delete(roomId);
    }
  });
}

/**
 * Get room statistics
 */
export function getRoomStats(roomId: string): RoomStats | undefined {
  return roomStats.get(roomId);
}

/**
 * Get room activity log
 */
export function getRoomActivity(roomId: string): RoomActivity[] {
  return roomStats.get(roomId)?.activityLog || [];
}

/**
 * Delete room and notify members
 */
export function deleteRoom(roomId: string, io: Socket['server']): void {
  const stats = roomStats.get(roomId);
  if (!stats) return;

  // Notify all members
  io.to(roomId).emit('roomDeleted', {
    roomId,
    reason: 'Room deleted by system'
  });

  // Remove all members
  stats.members.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket) {
      socket.leave(roomId);
    }
  });

  // Delete room stats
  roomStats.delete(roomId);
}
