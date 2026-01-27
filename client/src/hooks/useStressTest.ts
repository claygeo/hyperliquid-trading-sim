import { create } from 'zustand';
import { api } from '../lib/api';
import { wsClient } from '../lib/websocket';
import type { StressTestSpeed, WSMessage } from '../types/websocket';

interface TPSStats {
  current: number;
  average: number;
  peak: number;
  messageCount: number;
  latency: number;
}

interface StressTestState {
  speed: StressTestSpeed;
  isEnabled: boolean;
  tps: TPSStats;
  isChangingSpeed: boolean;
  error: string | null;

  setSpeed: (speed: StressTestSpeed) => Promise<void>;
  updateTPS: (stats: TPSStats) => void;
  subscribeToTPS: () => void;
}

export const useStressTestStore = create<StressTestState>((set, get) => ({
  speed: 'off',
  isEnabled: false,
  tps: {
    current: 0,
    average: 0,
    peak: 0,
    messageCount: 0,
    latency: 0,
  },
  isChangingSpeed: false,
  error: null,

  setSpeed: async (speed) => {
    set({ isChangingSpeed: true, error: null });
    try {
      await api.setStressTestSpeed(speed);
      set({
        speed,
        isEnabled: speed !== 'off',
        isChangingSpeed: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to change speed',
        isChangingSpeed: false,
      });
      throw error;
    }
  },

  updateTPS: (stats) => {
    set({ tps: stats });
  },

  subscribeToTPS: () => {
    wsClient.subscribe('tps');

    wsClient.on('tps', (msg: WSMessage) => {
      if (msg.data) {
        get().updateTPS(msg.data as TPSStats);
      }
    });
  },
}));

export function useStressTest() {
  return useStressTestStore();
}
