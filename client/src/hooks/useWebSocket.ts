import { useEffect, useCallback, useRef, useState } from 'react';
import { wsClient } from '../lib/websocket';
import type { WSMessage, WSMessageType } from '../types/websocket';

interface UseWebSocketOptions {
  autoConnect?: boolean;
  onMessage?: (message: WSMessage) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: Event) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const { autoConnect = true, onMessage, onConnect, onDisconnect, onError } = options;
  const [isConnected, setIsConnected] = useState(wsClient.isConnected);
  const handlersRef = useRef<Map<string, (message: WSMessage) => void>>(new Map());

  useEffect(() => {
    if (!autoConnect) return;

    const connect = async () => {
      try {
        await wsClient.connect();
        setIsConnected(true);
        onConnect?.();
      } catch (error) {
        onError?.(error as Event);
      }
    };

    connect();

    const unsubConnected = wsClient.on('connected', () => {
      setIsConnected(true);
      onConnect?.();
    });

    return () => {
      unsubConnected();
    };
  }, [autoConnect, onConnect, onError]);

  useEffect(() => {
    if (!onMessage) return;

    const unsub = wsClient.on('*', onMessage);
    return unsub;
  }, [onMessage]);

  const subscribe = useCallback((channel: string, handler?: (message: WSMessage) => void) => {
    wsClient.subscribe(channel);
    if (handler) {
      handlersRef.current.set(channel, handler);
      return wsClient.on(channel, handler);
    }
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    wsClient.unsubscribe(channel);
    const handler = handlersRef.current.get(channel);
    if (handler) {
      wsClient.off(channel, handler);
      handlersRef.current.delete(channel);
    }
  }, []);

  const send = useCallback((message: WSMessage) => {
    wsClient.send(message);
  }, []);

  const on = useCallback((type: WSMessageType | string, handler: (message: WSMessage) => void) => {
    return wsClient.on(type, handler);
  }, []);

  return {
    isConnected,
    subscribe,
    unsubscribe,
    send,
    on,
    connect: wsClient.connect.bind(wsClient),
    disconnect: wsClient.disconnect.bind(wsClient),
  };
}
