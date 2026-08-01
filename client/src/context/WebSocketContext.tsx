import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { wsClient } from '../lib/websocket';
import type { WSMessage, WSMessageType } from '../types/websocket';

interface WebSocketContextValue {
  isConnected: boolean;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  send: (message: WSMessage) => void;
  on: (type: WSMessageType | string, handler: (message: WSMessage) => void) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(wsClient.isConnected);

  useEffect(() => {
    const unsubscribeState = wsClient.onConnectionState(setIsConnected);
    setIsConnected(wsClient.isConnected);
    const connect = async () => {
      try {
        await wsClient.connect();
      } catch (error) {
        console.error('WebSocket connection failed:', error);
      }
    };

    connect();

    return () => {
      unsubscribeState();
      wsClient.disconnect();
    };
  }, []);

  return (
    <WebSocketContext.Provider
      value={{
        isConnected,
        subscribe: (channel) => wsClient.subscribe(channel),
        unsubscribe: (channel) => wsClient.unsubscribe(channel),
        send: (message) => wsClient.send(message),
        on: (type, handler) => wsClient.on(type, handler),
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useWS() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWS must be used within WebSocketProvider');
  }
  return context;
}
