import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Resolves the appropriate WebSocket URL for POLARIS real-time stream.
 * In browser environment: ws(s)://<host>/ws/realtime (proxied via Vite /ws proxy).
 * Fallback: ws://127.0.0.1:8000/ws/realtime.
 */
export function getRealtimeWsUrl(customUrl) {
  if (customUrl) return customUrl;
  if (typeof window !== 'undefined' && window.location) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || '127.0.0.1';
    // In local dev when Vite runs on 5173, connect directly to FastAPI backend on 8000
    if (window.location.port === '5173') {
      return `${protocol}//${hostname}:8000/ws/realtime`;
    }
    const host = window.location.host;
    if (host) {
      return `${protocol}//${host}/ws/realtime`;
    }
  }
  return 'ws://127.0.0.1:8000/ws/realtime';
}

/**
 * React hook for managing real-time WebSocket connection to /ws/realtime
 * with automatic reconnection, exponential backoff (1s - 16s, factor 1.5, jitter),
 * and dynamic state dispatch.
 *
 * @param {Object} options Hook configuration options
 * @param {string} [options.url] Optional custom WebSocket URL override
 * @param {number} [options.minDelay=1000] Minimum reconnection delay in ms (1s)
 * @param {number} [options.maxDelay=16000] Maximum reconnection delay in ms (16s)
 * @param {number} [options.factor=1.5] Exponential backoff factor
 * @param {number} [options.jitter=500] Maximum random jitter added to delay in ms
 * @param {boolean} [options.autoConnect=true] Whether to connect automatically on mount
 * @param {Function} [options.onMessage] Optional callback when telemetry frame arrives
 * @param {Function} [options.onConnect] Optional callback when connection is established
 * @param {Function} [options.onDisconnect] Optional callback when connection closes
 * @param {Function} [options.onError] Optional callback on connection error
 *
 * @returns {{
 *   isConnected: boolean,
 *   status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error',
 *   liveData: { type: string, timestamp: string, icebergs: Array, vessels: Array, telemetry: Object } | null,
 *   error: any,
 *   reconnect: () => void
 * }}
 */
export function useRealtimeStream(options = {}) {
  const {
    url,
    minDelay = 1000,
    maxDelay = 16000,
    factor = 1.5,
    jitter = 500,
    autoConnect = true,
    onMessage,
    onConnect,
    onDisconnect,
    onError
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState('connecting');
  const [liveData, setLiveData] = useState(null);
  const [error, setError] = useState(null);

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const retryCountRef = useRef(0);
  const isMountedRef = useRef(true);
  const isConnectedRef = useRef(false);

  // Preserve latest callback references without triggering reconnection
  const onMessageRef = useRef(onMessage);
  const onConnectRef = useRef(onConnect);
  const onDisconnectRef = useRef(onDisconnect);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onMessageRef.current = onMessage;
    onConnectRef.current = onConnect;
    onDisconnectRef.current = onDisconnect;
    onErrorRef.current = onError;
  }, [onMessage, onConnect, onDisconnect, onError]);

  // Cancel any scheduled reconnection timer
  const cancelReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  // Compute exponential backoff delay with jitter
  const getNextBackoffDelay = useCallback(() => {
    const exponent = retryCountRef.current;
    const baseDelay = minDelay * Math.pow(factor, exponent);
    const clampedDelay = Math.min(maxDelay, baseDelay);
    const randomJitter = Math.random() * jitter;
    return clampedDelay + randomJitter;
  }, [minDelay, maxDelay, factor, jitter]);

  // Connect / Reconnect socket
  const connect = useCallback(() => {
    if (!isMountedRef.current) return;
    cancelReconnectTimer();

    // Close any previous socket instance
    if (socketRef.current) {
      try {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onerror = null;
        socketRef.current.onclose = null;
        socketRef.current.close();
      } catch {
        // Safe ignore
      }
      socketRef.current = null;
    }

    const wsUrl = getRealtimeWsUrl(url);
    setStatus((prev) => (retryCountRef.current > 0 ? 'reconnecting' : 'connecting'));

    try {
      const ws = new WebSocket(wsUrl);
      socketRef.current = ws;

      ws.onopen = () => {
        if (!isMountedRef.current) {
          ws.close();
          return;
        }
        setIsConnected(true);
        isConnectedRef.current = true;
        setStatus('connected');
        setError(null);
        retryCountRef.current = 0; // Reset backoff counter
        if (onConnectRef.current) {
          onConnectRef.current();
        }
      };

      ws.onmessage = (event) => {
        if (!isMountedRef.current) return;
        try {
          const parsed = JSON.parse(event.data);
          setLiveData(parsed);
          if (onMessageRef.current) {
            onMessageRef.current(parsed);
          }
        } catch (parseErr) {
          console.warn('[useRealtimeStream] Error parsing JSON telemetry packet:', parseErr);
        }
      };

      ws.onerror = (errEvent) => {
        if (!isMountedRef.current) return;
        setError(errEvent);
        if (onErrorRef.current) {
          onErrorRef.current(errEvent);
        }
      };

      ws.onclose = (closeEvent) => {
        if (!isMountedRef.current) return;
        setIsConnected(false);
        isConnectedRef.current = false;
        socketRef.current = null;

        if (onDisconnectRef.current) {
          onDisconnectRef.current(closeEvent);
        }

        // Only schedule reconnect if not an explicit normal close (code 1000)
        if (closeEvent.code !== 1000) {
          setStatus('reconnecting');
          const delay = getNextBackoffDelay();
          retryCountRef.current += 1;
          reconnectTimerRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              connect();
            }
          }, delay);
        } else {
          setStatus('disconnected');
        }
      };
    } catch (createErr) {
      setError(createErr);
      setStatus('error');
      const delay = getNextBackoffDelay();
      retryCountRef.current += 1;
      reconnectTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          connect();
        }
      }, delay);
    }
  }, [url, cancelReconnectTimer, getNextBackoffDelay]);

  // Immediate manual reconnection trigger
  const reconnect = useCallback(() => {
    retryCountRef.current = 0;
    connect();
  }, [connect]);

  // Hook lifecycle management
  useEffect(() => {
    isMountedRef.current = true;
    if (autoConnect) {
      connect();
    }

    const handleOnline = () => {
      if (isMountedRef.current && !isConnectedRef.current) {
        reconnect();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }

    return () => {
      isMountedRef.current = false;
      isConnectedRef.current = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
      cancelReconnectTimer();
      if (socketRef.current) {
        try {
          socketRef.current.onopen = null;
          socketRef.current.onmessage = null;
          socketRef.current.onerror = null;
          socketRef.current.onclose = null;
          socketRef.current.close(1000, 'Hook unmounted');
        } catch {
          // Safe ignore
        }
        socketRef.current = null;
      }
    };
  }, [autoConnect, connect, reconnect, cancelReconnectTimer]);

  return {
    isConnected,
    status,
    liveData,
    error,
    reconnect
  };
}

export default useRealtimeStream;
