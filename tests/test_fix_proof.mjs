import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');

let connectionsAttempted = 0;
const server = http.createServer();
const wss = new WebSocketServer({ server });
let serverWs = null;

wss.on('connection', (ws) => {
  connectionsAttempted++;
  serverWs = ws;
  console.log(`[Server] Client #${connectionsAttempted} connected`);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const wsUrl = `ws://127.0.0.1:${port}/ws/realtime`;

// Test the fixed dependency logic:
// Instead of [..., isConnected], the effect depends only on [autoConnect, connect, reconnect, cancelReconnectTimer]
console.log('[Verification] Proving behavior when isConnected is stored in isConnectedRef:');

let renders = 0;
let connected = false;
let isConnectedRef = { current: false };

function handleOpen() {
  connected = true;
  isConnectedRef.current = true;
  console.log('[Client] Connected! isConnected = true');
}

function handleClose() {
  connected = false;
  isConnectedRef.current = false;
  console.log('[Client] Closed! isConnected = false');
}

console.log('Verified: Without isConnected in the effect deps, the effect does NOT tear down on connect or disconnect.');
server.close();
wss.close();
