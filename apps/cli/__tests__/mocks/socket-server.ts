/**
 * Mock Socket.IO server for CLI testing.
 */

import { Server as SocketIOServer } from 'socket.io';
import { createServer, type Server as HttpServer } from 'http';

export interface MockSocketServer {
  io: SocketIOServer;
  httpServer: HttpServer;
  start: () => Promise<number>;
  stop: () => Promise<void>;
  simulateAgentMessage: (sessionId: string, content: string) => void;
  simulateStreamToken: (sessionId: string, token: string) => void;
  simulateStreamEnd: (sessionId: string, messageId: string) => void;
  simulateApprovalRequest: (
    sessionId: string,
    approval: {
      approval_id: string;
      tool: string;
      description: string;
      command?: string;
    }
  ) => void;
  getConnectedClients: () => number;
}

export function createMockSocketServer(): MockSocketServer {
  const httpServer = createServer();
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  });

  const sessionRooms = new Map<string, Set<string>>();

  io.on('connection', (socket) => {
    // Handle session join
    socket.on('session_join', (data: { session_id: string; user_id: string }) => {
      socket.join(`session:${data.session_id}`);

      if (!sessionRooms.has(data.session_id)) {
        sessionRooms.set(data.session_id, new Set());
      }
      sessionRooms.get(data.session_id)!.add(socket.id);

      socket.emit('session_joined', {
        session_id: data.session_id,
        user_id: data.user_id,
      });
    });

    // Handle session leave
    socket.on('session_leave', (data: { session_id: string }) => {
      socket.leave(`session:${data.session_id}`);
      sessionRooms.get(data.session_id)?.delete(socket.id);
    });

    // Handle user messages
    socket.on('user_message', (data: { session_id: string; content: string }) => {
      io.to(`session:${data.session_id}`).emit('user_message_received', {
        session_id: data.session_id,
        content: data.content,
        timestamp: new Date().toISOString(),
      });
    });

    // Handle approval responses
    socket.on(
      'approval_response',
      (data: { session_id: string; approval_id: string; approved: boolean }) => {
        io.to(`session:${data.session_id}`).emit('approval_resolved', {
          session_id: data.session_id,
          approval_id: data.approval_id,
          approved: data.approved,
        });
      }
    );
  });

  const start = (): Promise<number> => {
    return new Promise((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        const port = typeof addr === 'object' ? addr?.port || 0 : 0;
        resolve(port);
      });
    });
  };

  const stop = (): Promise<void> => {
    return new Promise((resolve) => {
      io.close(() => {
        httpServer.close(() => resolve());
      });
    });
  };

  const simulateAgentMessage = (sessionId: string, content: string): void => {
    io.to(`session:${sessionId}`).emit('agent_message', {
      session_id: sessionId,
      message_id: `msg-${Date.now()}`,
      agent_id: 'agent-1',
      role: 'assistant',
      content,
      timestamp: new Date().toISOString(),
    });
  };

  const simulateStreamToken = (sessionId: string, token: string): void => {
    io.to(`session:${sessionId}`).emit('agent_stream_token', {
      session_id: sessionId,
      agent_id: 'agent-1',
      token,
    });
  };

  const simulateStreamEnd = (sessionId: string, messageId: string): void => {
    io.to(`session:${sessionId}`).emit('agent_stream_end', {
      session_id: sessionId,
      message_id: messageId,
      agent_id: 'agent-1',
    });
  };

  const simulateApprovalRequest = (
    sessionId: string,
    approval: {
      approval_id: string;
      tool: string;
      description: string;
      command?: string;
    }
  ): void => {
    io.to(`session:${sessionId}`).emit('approval_request', {
      session_id: sessionId,
      agent_id: 'agent-1',
      ...approval,
    });
  };

  const getConnectedClients = (): number => {
    return io.sockets.sockets.size;
  };

  return {
    io,
    httpServer,
    start,
    stop,
    simulateAgentMessage,
    simulateStreamToken,
    simulateStreamEnd,
    simulateApprovalRequest,
    getConnectedClients,
  };
}
