"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const node_http_1 = require("node:http");
const app_1 = require("./app");
const db_1 = require("./db");
const mailer_1 = require("./lib/mailer");
const socketServer_1 = require("./realtime/socketServer");
const PORT = Number(process.env.PORT ?? 4000);
// Install a real SMTP transport if the environment provides one. Before this
// runs, password-reset mail goes to the console (dev) or nowhere (prod).
(0, mailer_1.initMailerFromEnv)();
/**
 * The Express app and the WebSocket server share one HTTP server, and therefore
 * one port. A WebSocket connection begins life as an ordinary HTTP request with
 * an `Upgrade: websocket` header, so both can live on the same listener —
 * attachSocketServer claims the upgrade, Express handles everything else.
 *
 * `createApp()` still returns a plain app with no server bound, so the test
 * suite keeps driving it in-process with no port and no socket.
 */
const httpServer = (0, node_http_1.createServer)((0, app_1.createApp)());
const wss = (0, socketServer_1.attachSocketServer)(httpServer);
httpServer.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
    console.log(`WebSocket listening on ws://localhost:${PORT}/ws`);
});
/**
 * Graceful shutdown.
 *
 * A container orchestrator (or Ctrl-C) sends SIGTERM and then, after a grace
 * period, SIGKILL. Between the two we want to: stop accepting new work, close
 * the long-lived WebSockets (which otherwise hold the HTTP server open forever,
 * so its close callback would never fire), let in-flight HTTP requests finish,
 * and release the database pool cleanly. Skipping this is how a deploy drops
 * requests mid-flight and leaks connections.
 *
 * `once` per signal, and a hard-deadline timer, so a hung connection cannot keep
 * the process alive past the orchestrator's patience.
 */
let shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    console.log(`${signal} received — shutting down gracefully.`);
    // Ask clients to reconnect elsewhere (1001 = "going away"), then stop the
    // WebSocket server so it releases its hold on the HTTP server.
    for (const client of wss.clients) {
        client.close(1001, 'Server shutting down');
    }
    wss.close();
    httpServer.close(() => {
        db_1.pool
            .end()
            .then(() => {
            console.log('Closed HTTP server and database pool. Bye.');
            process.exit(0);
        })
            .catch((error) => {
            console.error('Error closing the database pool:', error);
            process.exit(1);
        });
    });
    // Backstop: if something refuses to close within 10s, exit anyway rather than
    // wait for SIGKILL. unref so this timer itself never keeps us alive.
    setTimeout(() => {
        console.error('Shutdown timed out after 10s — forcing exit.');
        process.exit(1);
    }, 10_000).unref();
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
//# sourceMappingURL=index.js.map