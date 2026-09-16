import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');

import * as React from '../frontend/node_modules/react/index.js';
import { useRealtimeStream } from '../frontend/src/services/useRealtimeStream.js';

let connectionsAttempted = 0;
const server = http.createServer();
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  connectionsAttempted++;
  console.log(`[Server] Client #${connectionsAttempted} connected`);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const wsUrl = `ws://127.0.0.1:${port}/ws/realtime`;

// Test with standard React dispatcher
let stateMap = new Map();
let effects = [];
let cleanups = [];
let refs = [];
let callbacks = [];
let renderCount = 0;

function runHook() {
  renderCount++;
  let stateIdx = 0;
  let effectIdx = 0;
  let refIdx = 0;
  let callbackIdx = 0;

  const dispatcher = {
    useState: (init) => {
      const id = stateIdx++;
      if (!stateMap.has(id)) {
        stateMap.set(id, typeof init === 'function' ? init() : init);
      }
      const setter = (val) => {
        const cur = stateMap.get(id);
        const next = typeof val === 'function' ? val(cur) : val;
        if (!Object.is(cur, next)) {
          stateMap.set(id, next);
          console.log(`[State ${id} changed]`, cur, '->', next);
          runHook();
        }
      };
      return [stateMap.get(id), setter];
    },
    useRef: (init) => {
      const id = refIdx++;
      if (!refs[id]) refs[id] = { current: init };
      return refs[id];
    },
    useCallback: (fn, deps) => {
      const id = callbackIdx++;
      if (!callbacks[id]) callbacks[id] = { fn, deps };
      const prev = callbacks[id];
      const hasChanged = !deps || !prev.deps || deps.some((d, i) => !Object.is(d, prev.deps[i]));
      if (hasChanged) {
        callbacks[id] = { fn, deps };
        return fn;
      }
      return prev.fn;
    },
    useEffect: (effect, deps) => {
      const id = effectIdx++;
      const prev = effects[id];
      const hasChanged = !prev || !deps || !prev.deps || deps.some((d, i) => !Object.is(d, prev.deps[i]));
      effects[id] = { effect, deps, hasChanged };
    },
    useMemo: (factory) => factory()
  };

  React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = dispatcher;
  const res = useRealtimeStream({ url: wsUrl, minDelay: 2000, maxDelay: 5000 });

  // Run effects
  for (let i = 0; i < effects.length; i++) {
    if (effects[i].hasChanged) {
      if (cleanups[i]) {
        console.log(`[Effect ${i}] Running cleanup because deps changed! Deps:`, effects[i].deps);
        cleanups[i]();
        cleanups[i] = null;
      }
      console.log(`[Effect ${i}] Running effect! Deps:`, effects[i].deps);
      cleanups[i] = effects[i].effect();
      effects[i].hasChanged = false;
    }
  }

  return res;
}

console.log('--- Mounting Hook ---');
runHook();

await new Promise(r => setTimeout(r, 200));

console.log(`\nTotal renders: ${renderCount}, Total server connections: ${connectionsAttempted}`);
server.close();
wss.close();
process.exit(0);
