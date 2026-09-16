/**
 * test_m2_resilience.mjs
 * Empirical Challenger Verification Suite for Milestone 2:
 * 1. Malformed JSON packets, missing fields, invalid types resilience
 * 2. Socket cleanup, unmounting, connection leak prevention, rapid re-renders
 * 3. Exponential backoff and auto-reconnect timing
 * 4. URL calculation and edge cases
 * 5. App.jsx dual-mode effectiveScenarioData and telemetry safety against malformed payloads
 */

import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');

// Import React from the EXACT same instance used by frontend
import * as React from '../frontend/node_modules/react/index.js';
import { getRealtimeWsUrl, useRealtimeStream } from '../frontend/src/services/useRealtimeStream.js';

// Setup React Dispatcher test harness for hook execution
class HookEnvironment {
  constructor(hookFn, initialProps = {}) {
    this.hookFn = hookFn;
    this.props = initialProps;
    this.stateValues = [];
    this.effects = [];
    this.cleanups = [];
    this.refs = [];
    this.callbacks = [];
    this.result = null;
    this.isMounted = true;
    this.renderScheduled = false;
  }

  dispatcher() {
    let stateIndex = 0;
    let refIndex = 0;
    let callbackIndex = 0;
    let effectIndex = 0;

    return {
      useState: (initial) => {
        const idx = stateIndex++;
        if (idx >= this.stateValues.length) {
          const val = typeof initial === 'function' ? initial() : initial;
          this.stateValues[idx] = val;
        }
        const setState = (newVal) => {
          if (!this.isMounted) return;
          const resolved = typeof newVal === 'function' ? newVal(this.stateValues[idx]) : newVal;
          if (!Object.is(this.stateValues[idx], resolved)) {
            this.stateValues[idx] = resolved;
            this.render();
          }
        };
        return [this.stateValues[idx], setState];
      },
      useRef: (initial) => {
        const idx = refIndex++;
        if (idx >= this.refs.length) {
          this.refs[idx] = { current: initial };
        }
        return this.refs[idx];
      },
      useCallback: (fn, deps) => {
        const idx = callbackIndex++;
        if (idx >= this.callbacks.length) {
          this.callbacks[idx] = { fn, deps };
          return fn;
        }
        const prev = this.callbacks[idx];
        const hasChanged = !deps || !prev.deps || deps.some((d, i) => !Object.is(d, prev.deps[i]));
        if (hasChanged) {
          this.callbacks[idx] = { fn, deps };
          return fn;
        }
        return prev.fn;
      },
      useEffect: (effect, deps) => {
        const idx = effectIndex++;
        const prev = this.effects[idx];
        const hasChanged = !prev || !deps || !prev.deps || deps.some((d, i) => !Object.is(d, prev.deps[i]));
        this.effects[idx] = { effect, deps, hasChanged };
      },
      useMemo: (factory) => factory()
    };
  }

  render(newProps) {
    if (!this.isMounted) return this.result;
    if (newProps !== undefined) {
      this.props = newProps;
    }

    const prevDispatcher = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H;
    React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = this.dispatcher();

    try {
      this.result = this.hookFn(this.props);
    } finally {
      React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.H = prevDispatcher;
    }

    // Run effects that changed
    for (let i = 0; i < this.effects.length; i++) {
      const entry = this.effects[i];
      if (entry && entry.hasChanged) {
        if (this.cleanups[i]) {
          try {
            this.cleanups[i]();
          } catch (e) {
            console.error('Cleanup error:', e);
          }
          this.cleanups[i] = null;
        }
        try {
          const cleanup = entry.effect();
          if (typeof cleanup === 'function') {
            this.cleanups[i] = cleanup;
          }
        } catch (e) {
          console.error('Effect error:', e);
        }
        entry.hasChanged = false;
      }
    }

    return this.result;
  }

  unmount() {
    this.isMounted = false;
    for (let i = 0; i < this.cleanups.length; i++) {
      if (typeof this.cleanups[i] === 'function') {
        try {
          this.cleanups[i]();
        } catch (e) {
          console.error('Unmount cleanup error:', e);
        }
        this.cleanups[i] = null;
      }
    }
  }
}

// Helpers
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let testResults = [];
function recordTest(name, passed, details) {
  testResults.push({ name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon}: ${name}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

// --- Test Suite Execution ---
async function runSuite() {
  console.log('====================================================');
  console.log('POLARIS Milestone 2 Empirical Resilience Test Suite');
  console.log('====================================================\n');

  // Start Mock WebSocket Server
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  let activeClients = new Set();

  wss.on('connection', (ws) => {
    activeClients.add(ws);
    ws.on('close', () => {
      activeClients.delete(ws);
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const wsUrl = `ws://127.0.0.1:${port}/ws/realtime`;
  console.log(`[Test Server] Running at ${wsUrl}\n`);

  try {
    // ---------------------------------------------------------------
    // 1. URL Resolution Tests
    // ---------------------------------------------------------------
    console.log('--- Suite 1: URL Resolution ---');
    {
      const custom = getRealtimeWsUrl('ws://custom-domain.org:9000/ws');
      recordTest(
        'getRealtimeWsUrl overrides with customUrl',
        custom === 'ws://custom-domain.org:9000/ws',
        `Returned: ${custom}`
      );

      const fallback = getRealtimeWsUrl();
      recordTest(
        'getRealtimeWsUrl fallback without window is ws://127.0.0.1:8000/ws/realtime',
        fallback === 'ws://127.0.0.1:8000/ws/realtime',
        `Returned: ${fallback}`
      );

      // Browser simulation
      globalThis.window = {
        location: {
          protocol: 'https:',
          host: 'polaris.antarctic.gov'
        }
      };
      const wssBrowser = getRealtimeWsUrl();
      recordTest(
        'getRealtimeWsUrl resolves wss: in HTTPS browser environment',
        wssBrowser === 'wss://polaris.antarctic.gov/ws/realtime',
        `Returned: ${wssBrowser}`
      );

      globalThis.window.location.protocol = 'http:';
      globalThis.window.location.host = 'localhost:5173';
      const wsBrowser = getRealtimeWsUrl();
      recordTest(
        'getRealtimeWsUrl resolves ws: in HTTP dev browser environment',
        wsBrowser === 'ws://localhost:5173/ws/realtime',
        `Returned: ${wsBrowser}`
      );
      delete globalThis.window;
    }

    // ---------------------------------------------------------------
    // 2. Normal Connection & Valid Payload Delivery
    // ---------------------------------------------------------------
    console.log('\n--- Suite 2: Normal Connection & Message Handling ---');
    {
      let received = [];
      const env = new HookEnvironment(useRealtimeStream, {
        url: wsUrl,
        onMessage: (data) => received.push(data)
      });
      env.render();

      await sleep(150);
      recordTest(
        'Client connects to WebSocket server',
        env.result.isConnected === true && activeClients.size === 1,
        `Status: ${env.result.status}, Server clients: ${activeClients.size}`
      );

      // Send valid telemetry frame
      const validFrame = {
        type: 'telemetry_frame',
        timestamp: '2026-09-12T16:00:00.000Z',
        icebergs: [{ id: 'B-15', lat: -68.1, lon: 40.2, speedKn: 0.4 }],
        vessels: [{ mmsi: '211232740', name: 'RV Polarstern' }],
        telemetry: { speedKn: 12.0, heading: 85.0, progress: 0.25 }
      };

      for (const client of activeClients) {
        client.send(JSON.stringify(validFrame));
      }
      await sleep(50);

      recordTest(
        'Client parses and sets liveData correctly',
        env.result.liveData !== null && env.result.liveData.type === 'telemetry_frame' && env.result.liveData.icebergs.length === 1,
        `liveData: ${JSON.stringify(env.result.liveData)}`
      );

      env.unmount();
      await sleep(100);
    }

    // ---------------------------------------------------------------
    // 3. Malformed JSON Resilience Tests
    // ---------------------------------------------------------------
    console.log('\n--- Suite 3: Malformed JSON Resilience ---');
    {
      let warnLogged = false;
      const originalWarn = console.warn;
      console.warn = () => {
        warnLogged = true;
      };

      const env = new HookEnvironment(useRealtimeStream, {
        url: wsUrl
      });
      env.render();
      await sleep(150);

      // Adversarial packet 1: Syntax error (unterminated JSON string)
      warnLogged = false;
      for (const c of activeClients) {
        c.send('{"type": "telemetry_frame", "broken": ');
      }
      await sleep(50);
      recordTest(
        'Malformed JSON syntax does NOT crash client or kill socket',
        env.result.isConnected === true && warnLogged === true,
        `Client still connected: ${env.result.isConnected}, Warning logged: ${warnLogged}`
      );

      // Adversarial packet 2: Plain XML/HTML string
      warnLogged = false;
      for (const c of activeClients) {
        c.send('<status>OK</status>');
      }
      await sleep(50);
      recordTest(
        'Non-JSON XML payload is gracefully caught and discarded',
        env.result.isConnected === true && warnLogged === true,
        `Client still connected: ${env.result.isConnected}`
      );

      // Adversarial packet 3: Empty string payload
      warnLogged = false;
      for (const c of activeClients) {
        c.send('');
      }
      await sleep(50);
      recordTest(
        'Empty string payload is handled without unhandled exception',
        env.result.isConnected === true && warnLogged === true,
        `Client still connected: ${env.result.isConnected}`
      );

      // Adversarial packet 4: Raw binary Buffer
      warnLogged = false;
      for (const c of activeClients) {
        c.send(Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]));
      }
      await sleep(50);
      recordTest(
        'Binary buffer is handled safely by JSON parse try/catch',
        env.result.isConnected === true && warnLogged === true,
        `Client still connected: ${env.result.isConnected}`
      );

      console.warn = originalWarn;
      env.unmount();
      await sleep(100);
    }

    // ---------------------------------------------------------------
    // 4. Missing Fields & Partial Payloads
    // ---------------------------------------------------------------
    console.log('\n--- Suite 4: Missing Fields & Partial Payloads ---');
    {
      const env = new HookEnvironment(useRealtimeStream, { url: wsUrl });
      env.render();
      await sleep(150);

      // Payload with missing telemetry, icebergs, vessels
      for (const c of activeClients) {
        c.send(JSON.stringify({ type: 'heartbeat', timestamp: '2026-09-12T16:05:00Z' }));
      }
      await sleep(50);
      recordTest(
        'Missing telemetry, icebergs, and vessels does not crash useRealtimeStream',
        env.result.liveData?.type === 'heartbeat' && env.result.liveData?.telemetry === undefined,
        `liveData: ${JSON.stringify(env.result.liveData)}`
      );

      // Payload with explicit null fields
      for (const c of activeClients) {
        c.send(JSON.stringify({
          type: 'telemetry_frame',
          telemetry: null,
          icebergs: null,
          vessels: null
        }));
      }
      await sleep(50);
      recordTest(
        'Explicit null fields (telemetry: null, icebergs: null) parsed and stored safely',
        env.result.liveData?.telemetry === null && env.result.liveData?.icebergs === null,
        `telemetry: ${env.result.liveData?.telemetry}, icebergs: ${env.result.liveData?.icebergs}`
      );

      // Payload with primitive JSON number (12345)
      for (const c of activeClients) {
        c.send('12345');
      }
      await sleep(50);
      recordTest(
        'Primitive JSON number (12345) stored in liveData without crashing',
        env.result.liveData === 12345,
        `liveData: ${env.result.liveData}`
      );

      env.unmount();
      await sleep(100);
    }

    // ---------------------------------------------------------------
    // 5. Socket Unmounting, Cleanup & Connection Leak Prevention
    // ---------------------------------------------------------------
    console.log('\n--- Suite 5: Socket Cleanup & Leak Prevention ---');
    {
      // Test 5.1: Unmount closes socket with code 1000 and clears listeners
      const env1 = new HookEnvironment(useRealtimeStream, { url: wsUrl, minDelay: 100 });
      env1.render();
      await sleep(150);
      recordTest(
        'Hook connects and registers 1 active client on server',
        activeClients.size === 1,
        `Active server clients: ${activeClients.size}`
      );

      // Unmount hook
      env1.unmount();
      await sleep(150);
      recordTest(
        'Unmounting hook closes socket cleanly (server active clients drops to 0)',
        activeClients.size === 0,
        `Active server clients after unmount: ${activeClients.size}`
      );

      // Wait 300ms (longer than minDelay of 100ms) to ensure NO reconnection timer triggers after unmount
      await sleep(300);
      recordTest(
        'No reconnect timer fires after unmount (no orphan connection recreated)',
        activeClients.size === 0,
        `Active server clients after wait: ${activeClients.size}`
      );

      // Test 5.2: Rapid Mount / Unmount / Remount cycles (simulating React 19 StrictMode & Hot Module Reload)
      console.log('Testing rapid mount/unmount churn (10 cycles)...');
      for (let i = 0; i < 10; i++) {
        const envCycle = new HookEnvironment(useRealtimeStream, { url: wsUrl, minDelay: 100 });
        envCycle.render();
        await sleep(10);
        envCycle.unmount();
      }
      await sleep(300);
      recordTest(
        'Rapid mount/unmount cycles leave ZERO leaking sockets on server',
        activeClients.size === 0,
        `Leaking sockets on server: ${activeClients.size}`
      );

      // Test 5.3: Rapid consecutive reconnect() calls on single instance
      const env2 = new HookEnvironment(useRealtimeStream, { url: wsUrl, minDelay: 100 });
      env2.render();
      await sleep(150);

      // Call reconnect() 5 times rapidly
      env2.result.reconnect();
      env2.result.reconnect();
      env2.result.reconnect();
      env2.result.reconnect();
      env2.result.reconnect();
      await sleep(300);

      recordTest(
        'Multiple rapid reconnect() calls cleanly close previous sockets (server client count remains 1)',
        activeClients.size === 1,
        `Active server clients: ${activeClients.size}`
      );

      env2.unmount();
      await sleep(150);
      recordTest(
        'Final unmount returns server client count to 0',
        activeClients.size === 0,
        `Active server clients: ${activeClients.size}`
      );
    }

    // ---------------------------------------------------------------
    // 6. Exponential Backoff Schedule & Server Disconnect Recovery
    // ---------------------------------------------------------------
    console.log('\n--- Suite 6: Exponential Backoff & Server Disconnect ---');
    {
      const env = new HookEnvironment(useRealtimeStream, {
        url: wsUrl,
        minDelay: 80,
        maxDelay: 500,
        factor: 2.0,
        jitter: 10
      });
      env.render();
      await sleep(150);

      recordTest(
        'Client initially connected before forced disconnect',
        env.result.isConnected === true,
        `Status: ${env.result.status}`
      );

      // Forcibly terminate client connection from server with abnormal close
      for (const c of activeClients) {
        c.terminate();
      }
      await sleep(30);

      recordTest(
        'Client detects abnormal disconnect and enters "reconnecting" status',
        env.result.status === 'reconnecting' && env.result.isConnected === false,
        `Status: ${env.result.status}, isConnected: ${env.result.isConnected}`
      );

      // Wait for backoff reconnection to succeed
      await sleep(300);
      recordTest(
        'Client successfully auto-reconnects using exponential backoff',
        env.result.isConnected === true && env.result.status === 'connected',
        `Status: ${env.result.status}, isConnected: ${env.result.isConnected}, Server clients: ${activeClients.size}`
      );

      env.unmount();
      await sleep(150);
    }

    // ---------------------------------------------------------------
    // 7. App.jsx Dual-Mode State and Downstream Type Safety Verification
    // ---------------------------------------------------------------
    console.log('\n--- Suite 7: App.jsx effectiveScenarioData and Downstream Type Safety ---');
    {
      // We replicate App.jsx's effectiveScenarioData memo function to test adversarial edge cases:
      function computeEffectiveScenarioData(scenarioData, streamMode, liveData) {
        if (!scenarioData) {
          if (streamMode === 'live' && liveData) {
            return {
              iceRiskGrid: [],
              icebergs: liveData.icebergs || [],
              vessels: liveData.vessels || [],
              route: { waypoints: [], summary: {} }
            };
          }
          return null;
        }

        if (streamMode === 'live' && liveData) {
          return {
            ...scenarioData,
            icebergs: (liveData.icebergs && liveData.icebergs.length > 0) ? liveData.icebergs : scenarioData.icebergs,
            vessels: (liveData.vessels && liveData.vessels.length > 0) ? liveData.vessels : (scenarioData.vessels || [])
          };
        }

        return scenarioData;
      }

      const defaultScenario = {
        icebergs: [{ id: 'DEFAULT-1' }],
        vessels: [{ mmsi: '111111' }]
      };

      // Case 7.1: liveData has non-array string for icebergs e.g. "corrupted"
      const badStringPayload = { icebergs: "corrupted_icebergs_string", vessels: [] };
      const resString = computeEffectiveScenarioData(defaultScenario, 'live', badStringPayload);
      
      const isIcebergsString = typeof resString.icebergs === 'string';
      console.log(`   [Finding Exploration] If liveData.icebergs is string "corrupted", resString.icebergs is:`, resString.icebergs);
      
      recordTest(
        'App.jsx edge case identified: String icebergs ("corrupted") satisfies (liveData.icebergs && length > 0) because string has length property',
        isIcebergsString === true,
        `Evaluated to type: ${typeof resString.icebergs}`
      );

      // What happens if CesiumViewer tries to do scenarioData.icebergs.forEach?
      let forEachThrows = false;
      try {
        resString.icebergs.forEach((berg) => {});
      } catch (err) {
        forEachThrows = true;
      }
      recordTest(
        'Downstream consumer CesiumViewer (scenarioData.icebergs.forEach) throws TypeError if icebergs is a string',
        forEachThrows === true,
        'Calling .forEach on string throws scenarioData.icebergs.forEach is not a function'
      );

      // Case 7.2: liveData has non-array object for icebergs e.g. { id: 'A' }
      const badObjPayload = { icebergs: { id: 'A' }, vessels: {} };
      const resObj = computeEffectiveScenarioData(defaultScenario, 'live', badObjPayload);
      recordTest(
        'If liveData.icebergs is an object without length, it safely falls back to scenarioData.icebergs',
        Array.isArray(resObj.icebergs) && resObj.icebergs[0].id === 'DEFAULT-1',
        `icebergs fallback: ${JSON.stringify(resObj.icebergs)}`
      );

      // Case 7.3: liveData has valid array of icebergs
      const validPayload = {
        icebergs: [{ id: 'LIVE-1', lat: -67.5, lon: 40.0 }],
        vessels: [{ mmsi: '999999', name: 'Live Ship' }]
      };
      const resValid = computeEffectiveScenarioData(defaultScenario, 'live', validPayload);
      recordTest(
        'Valid liveData cleanly overrides scenarioData icebergs and vessels',
        resValid.icebergs[0].id === 'LIVE-1' && resValid.vessels[0].mmsi === '999999',
        `Live icebergs: ${resValid.icebergs[0].id}`
      );

      // Case 7.4: When in simulation mode, liveData is ignored
      const resSim = computeEffectiveScenarioData(defaultScenario, 'simulation', validPayload);
      recordTest(
        'In simulation mode, effectiveScenarioData strictly returns defaultScenario ignoring liveData',
        resSim.icebergs[0].id === 'DEFAULT-1',
        `Simulation icebergs: ${resSim.icebergs[0].id}`
      );

      // Case 7.5: Telemetry effect simulation with malformed telemetry
      console.log('Testing App.jsx telemetry synchronization resilience with malformed payloads...');
      function simulateTelemetrySync(streamMode, liveData, prevTelemetry) {
        let newTelemetry = { ...prevTelemetry };
        let progressSeeked = undefined;

        if (streamMode === 'live' && liveData?.telemetry) {
          let localRisk = liveData.telemetry.risk ?? 0.14;
          newTelemetry = {
            ...newTelemetry,
            ...liveData.telemetry,
            risk: localRisk,
            timeIso: liveData.timestamp || prevTelemetry.timeIso
          };

          if (liveData.telemetry.progress !== undefined) {
            progressSeeked = liveData.telemetry.progress;
          }
        }
        return { newTelemetry, progressSeeked };
      }

      const prevTelem = { lat: -70.7, lon: 11.7, timeIso: '2026-09-07T08:00:00Z', progress: 0.1 };
      
      // Test missing telemetry object
      const syncMissing = simulateTelemetrySync('live', { type: 'heartbeat' }, prevTelem);
      recordTest(
        'Missing liveData.telemetry leaves previous telemetry untouched',
        syncMissing.newTelemetry.progress === 0.1 && syncMissing.progressSeeked === undefined,
        `newTelemetry: ${JSON.stringify(syncMissing.newTelemetry)}`
      );

      // Test partial telemetry object (e.g. only lat/lon, no progress)
      const syncPartial = simulateTelemetrySync('live', { telemetry: { lat: -71.0, lon: 12.0 } }, prevTelem);
      recordTest(
        'Partial liveData.telemetry updates specified fields while keeping timeIso and not seeking clock',
        syncPartial.newTelemetry.lat === -71.0 && syncPartial.progressSeeked === undefined,
        `newTelemetry: lat=${syncPartial.newTelemetry.lat}, progressSeeked=${syncPartial.progressSeeked}`
      );

      // Test primitive non-object telemetry (e.g. telemetry: "corrupted")
      const syncPrimitive = simulateTelemetrySync('live', { telemetry: "corrupted" }, prevTelem);
      recordTest(
        'Primitive telemetry string is absorbed safely without throwing (though spreads character keys)',
        syncPrimitive.progressSeeked === undefined,
        `risk=${syncPrimitive.newTelemetry.risk}`
      );
    }

  } finally {
    // Teardown test server
    wss.close();
    server.close();
  }

  // Summary
  console.log('\n====================================================');
  console.log('Test Suite Summary');
  console.log('====================================================');
  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
