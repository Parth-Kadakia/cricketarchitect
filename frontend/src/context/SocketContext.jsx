import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBaseUrl } from '../api/client';
import { useAuth } from './AuthContext';

const SocketContext = createContext(null);

function resolveSocketUrl() {
  const explicit = import.meta.env.VITE_WS_URL;
  if (explicit) {
    return explicit;
  }

  const apiUrl = new URL(getApiBaseUrl());
  const protocol = apiUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${apiUrl.host}/ws`;
}

export function SocketProvider({ children }) {
  const { token } = useAuth();
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState(null);

  const socketRef = useRef(null);
  const reconnectRef = useRef(null);
  const listenersRef = useRef(new Map());

  useEffect(() => {
    const wsUrl = resolveSocketUrl();

    function openSocket() {
      const socket = new WebSocket(`${wsUrl}${token ? `?token=${encodeURIComponent(token)}` : ''}`);
      socketRef.current = socket;

      socket.onopen = () => {
        setConnected(true);
      };

      socket.onclose = () => {
        setConnected(false);

        if (reconnectRef.current) {
          window.clearTimeout(reconnectRef.current);
        }

        reconnectRef.current = window.setTimeout(openSocket, 2500);
      };

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          setLastEvent(message);

          const globalListeners = listenersRef.current.get('*') || new Set();
          const namedListeners = listenersRef.current.get(message.event) || new Set();

          [...globalListeners, ...namedListeners].forEach((listener) => {
            listener(message);
          });
        } catch (error) {
          // Ignore malformed payloads from external clients.
        }
      };
    }

    openSocket();

    return () => {
      if (reconnectRef.current) {
        window.clearTimeout(reconnectRef.current);
      }

      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [token]);

  function send(message) {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    }
  }

  function subscribe(eventName, handler) {
    if (!listenersRef.current.has(eventName)) {
      listenersRef.current.set(eventName, new Set());
    }

    listenersRef.current.get(eventName).add(handler);

    return () => {
      const listeners = listenersRef.current.get(eventName);
      if (listeners) {
        listeners.delete(handler);
      }
    };
  }

  const value = useMemo(
    () => ({
      connected,
      lastEvent,
      send,
      subscribe
    }),
    [connected, lastEvent]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
}
