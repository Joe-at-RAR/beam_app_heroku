import { Server } from 'socket.io';
import config from '../config';

// Export a function to create a new Socket.IO server instance
export function createSocketServer(httpServer: any) {
  return new Server(httpServer, {
    cors: {
      origin: config.server.corsOrigin,
      methods: ['GET', 'POST']
    }
  });
}

// Export a default io variable that will be set when the server is initialized
let io: Server;
export function setIo(socketServer: Server) {
  io = socketServer;
}
export { io };
