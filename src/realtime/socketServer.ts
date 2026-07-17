/**
 * Attaches a WebSocket server to the existing HTTP server and connects each
 * authenticated socket to the hub.
 *
 * This is the one file that imports `ws`. It translates a real WebSocket into
 * the tiny `Connection` interface the hub understands, so nothing downstream
 * depends on the library.
 */
import type { Server as HttpServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { verifyToken } from '../lib/token';
import { Connection, register, unregister } from './hub';
import { handleConnect, handleDisconnect } from './presenceService';

/** Where the client connects: ws://host/ws?token=<jwt>. */
const WS_PATH = '/ws';

/**
 * How often we probe each socket, and the rule for calling one dead.
 *
 * TCP will happily hold a connection open for many minutes after the peer has
 * vanished — a closed laptop, a dropped Wi-Fi. Without our own liveness check,
 * those ghosts sit in the hub and we "deliver" to a black hole. So every
 * interval we ping; a socket that has not answered the *previous* ping by the
 * next one is terminated. The browser answers ping frames automatically, at the
 * protocol level, so this needs no client code.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** ws does not carry our own flags, so we tack liveness onto the instance. */
interface TrackedSocket extends WebSocket {
  isAlive: boolean;
  userId: number;
}

/**
 * Pulls the JWT from the query string.
 *
 * A browser's native WebSocket cannot set an Authorization header — the API is
 * headerless by design — so the token rides in the URL instead. The tradeoff:
 * a full ws:// URL can land in an access log, token included, in a way a POST
 * body would not. That is the same class of exposure as the localStorage token
 * already accepted (see client authStorage), and acceptable for this project;
 * a hardening pass would move to a short-lived ticket fetched over HTTPS first.
 */
function tokenFromRequestUrl(url: string | undefined): string | null {
  if (!url) return null;
  // The base is a throwaway — we only want the query parsing. req.url is a path.
  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname !== WS_PATH) return null;
  const token = parsed.searchParams.get('token');
  return token && token.length > 0 ? token : null;
}

export function attachSocketServer(httpServer: HttpServer): WebSocketServer {
  // noServer, not { server }: we intercept the HTTP upgrade ourselves so an
  // unauthenticated client is refused *before* a WebSocket handshake completes,
  // rather than connected and then dropped.
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const token = tokenFromRequestUrl(req.url);
    if (token === null) {
      // Not our path, or no token. 400 and close the raw socket.
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    let userId: number;
    try {
      userId = verifyToken(token);
    } catch {
      // A bad or expired token. 401 before any WebSocket exists.
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const tracked = ws as TrackedSocket;
      tracked.userId = userId;
      tracked.isAlive = true;
      wss.emit('connection', tracked, req);
    });
  });

  wss.on('connection', (ws: TrackedSocket) => {
    // Adapt the real socket to the hub's minimal interface.
    const connection: Connection = {
      send: (data) => ws.send(data),
      get isOpen() {
        return ws.readyState === WebSocket.OPEN;
      },
    };

    // register reports the offline->online transition, so presence is announced
    // once per user, not once per tab.
    if (register(ws.userId, connection)) {
      void handleConnect(ws.userId);
    }

    // A pong marks the socket alive again until the next sweep.
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    // close and error can both fire for one socket; unregister only reports the
    // last-socket transition once, so handleDisconnect runs a single time.
    const onGone = (): void => {
      if (unregister(ws.userId, connection)) {
        void handleDisconnect(ws.userId);
      }
    };

    // This scope only pushes server->client. Inbound frames (a client speaking
    // out of turn) are ignored rather than trusted — sending goes over REST,
    // where it is already validated.
    ws.on('close', onGone);
    ws.on('error', onGone);
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients as Set<TrackedSocket>) {
      if (!ws.isAlive) {
        // Missed the last round. terminate() is the abrupt close — the peer is
        // already gone, so a polite close handshake would just hang.
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Node keeps the process alive for a pending interval; without unref a clean
  // shutdown would wait on this timer. And stop it entirely when the server does.
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}
