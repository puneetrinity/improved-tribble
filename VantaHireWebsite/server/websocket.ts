import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'http';

let wss: WebSocketServer | null = null;
const clientsByJobId = new Map<number, Set<WebSocket>>();

export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    
    // Match the WebSocket path format: /api/sourcing/ws/:jobId
    const match = url.pathname.match(/^\/api\/sourcing\/ws\/(\d+)$/);
    if (!match) {
      // Not our path — do NOT destroy the socket, let other handlers (Vite HMR) process it
      return;
    }

    const jobId = parseInt(match[1] as string, 10);

    wss!.handleUpgrade(request, socket, head, (ws) => {
      // Register the new WebSocket connection
      if (!clientsByJobId.has(jobId)) {
        clientsByJobId.set(jobId, new Set());
      }
      clientsByJobId.get(jobId)!.add(ws);
      console.log(`[WS] Client connected for jobId=${jobId}, total=${clientsByJobId.get(jobId)!.size}`);

      // Send immediate acknowledgement so the client knows the socket is live
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'connected', jobId }));
      }

      // Cleanup on disconnect
      ws.on('close', () => {
        const jobClients = clientsByJobId.get(jobId);
        if (jobClients) {
          jobClients.delete(ws);
          if (jobClients.size === 0) {
            clientsByJobId.delete(jobId);
          }
        }
        console.log(`[WS] Client disconnected for jobId=${jobId}`);
      });
    });
  });
}


export function broadcastSourcingUpdate(jobId: number, payload?: any) {
  const jobClients = clientsByJobId.get(jobId);
  if (!jobClients || jobClients.size === 0) return;

  const message = JSON.stringify({
    type: 'sourcing_update',
    jobId,
    timestamp: new Date().toISOString(),
    ...payload
  });

  for (const client of jobClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

/**
 * Broadcast a typed pipeline event to all WS clients subscribed to this jobId.
 * Used by the sourcing/enrichment pipeline to push real-time progress events.
 */
export function broadcastPipelineEvent(jobId: number, type: string, payload: Record<string, unknown> = {}) {
  const jobClients = clientsByJobId.get(jobId);
  if (!jobClients || jobClients.size === 0) return;

  const message = JSON.stringify({
    type,
    jobId,
    timestamp: new Date().toISOString(),
    ...payload,
  });

  for (const client of jobClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
