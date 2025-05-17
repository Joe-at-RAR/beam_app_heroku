import http from 'http';
import { Server } from 'socket.io';
import { io as ioc, Socket } from 'socket.io-client';
import { AddressInfo } from 'net';
import { initSocket, io } from '../../socket';
import { socketAuth } from '../../middleware/socket-auth';

// Mock authentication middleware
jest.mock('../../middleware/socket-auth', () => ({
  socketAuth: jest.fn().mockImplementation(() => (socket: any, next: Function) => next()),
  roomAuth: jest.fn().mockImplementation(() => (socket: any, next: Function) => next()),
  rateLimiter: jest.fn().mockImplementation(() => (socket: any, next: Function) => next())
}));

// Mock Server class to expose configuration
jest.mock('socket.io', () => {
  const originalSocketIo = jest.requireActual('socket.io');
  // Create a mock Server class that exposes configuration
  class MockServer extends originalSocketIo.Server {
    // Make configuration options public
    public get configuration() {
      return {
        cors: this['opts'].cors,
        path: this['opts'].path
      };
    }
  }
  return { Server: MockServer };
});

describe('Socket Implementation', () => {
  let httpServer: http.Server;
  let serverSocket: Server;
  let clientSocket: Socket;
  let port: number;
  
  beforeAll((done) => {
    // Create HTTP server
    httpServer = http.createServer();
    
    // Initialize Socket.IO server
    serverSocket = initSocket(httpServer);
    
    // Start listening
    httpServer.listen(() => {
      // Get port from server
      port = (httpServer.address() as AddressInfo).port;
      
      // Connect client
      clientSocket = ioc(`http://localhost:${port}`, {
        auth: {
          token: 'test-token',
          silknotePatientUuid: 'test-patient'
        }
      });
      
      clientSocket.on('connect', done);
    });
  });
  
  afterAll(() => {
    // Clean up
    clientSocket.disconnect();
    serverSocket.close();
    httpServer.close();
  });
  
  test('applies socket authentication middleware', () => {
    // Check if socketAuth middleware was applied
    expect(socketAuth).toHaveBeenCalled();
  });
  
  test('configures socket with correct options', () => {
    // Access configuration through our public getter
    const config = (serverSocket as any).configuration;
    
    // Check if io is properly configured
    expect(config).toBeDefined();
    expect(config.cors).toBeDefined();
    expect(config.path).toBe('/socket.io');
  });
  
  test('emits events to rooms', (done) => {
    // Listen for test event on client
    clientSocket.on('testEvent', (data) => {
      expect(data).toEqual({ message: 'Test event data' });
      done();
    });
    
    // Join room
    clientSocket.emit('joinRoom', 'test-patient');
    
    // Wait for room join to complete
    setTimeout(() => {
      // Emit event to room
      io.to('test-patient').emit('testEvent', { message: 'Test event data' });
    }, 50);
  });
  
  test('handles document status events', (done) => {
    // Listen for fileStatus event on client
    clientSocket.on('fileStatus', (data) => {
      expect(data.fileId).toBe('test-file-123');
      expect(data.status).toBe('processing');
      done();
    });
    
    // Emit fileStatus event to room
    io.to('test-patient').emit('fileStatus', {
      fileId: 'test-file-123',
      status: 'processing',
      timestamp: new Date().toISOString()
    });
  });
  
  test('handles disconnection', (done) => {
    // Mock handlers
    const disconnectHandler = jest.fn();
    const connectionHandler = jest.fn();
    
    // Register handlers on server
    io.on('connection', (socket) => {
      connectionHandler();
      socket.on('disconnect', disconnectHandler);
    });
    
    // Create new client that will disconnect
    const tempClient = ioc(`http://localhost:${port}`, {
      auth: {
        token: 'test-token-2',
        silknotePatientUuid: 'test-patient-2'
      }
    });
    
    tempClient.on('connect', () => {
      // Disconnect after connection
      tempClient.disconnect();
      
      // Check disconnect handler after short delay
      setTimeout(() => {
        expect(disconnectHandler).toHaveBeenCalled();
        done();
      }, 50);
    });
  });
  
  test('validates client authentication', (done) => {
    // Mock the auth middleware to actually validate
    (socketAuth as jest.Mock).mockImplementationOnce(() => (socket: any, next: Function) => {
      // Check auth token
      if (socket.handshake.auth.token !== 'valid-token') {
        return next(new Error('Invalid token'));
      }
      next();
    });
    
    // Try to connect with invalid token
    const invalidClient = ioc(`http://localhost:${port}`, {
      auth: {
        token: 'invalid-token',
        silknotePatientUuid: 'test-patient'
      }
    });
    
    // Handle connection error
    invalidClient.on('connect_error', (err) => {
      expect(err.message).toContain('Invalid token');
      invalidClient.disconnect();
      done();
    });
  });
}); 