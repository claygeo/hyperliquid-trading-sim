import { create } from 'zustand';
import { api } from '../lib/api';
import { wsClient } from '../lib/websocket';
import type { Position, PlaceOrderRequest } from '../types/trading';
import type { WSMessage } from '../types/websocket';

interface PositionsState {
  positions: Position[];
  isLoading: boolean;
  isPlacingOrder: boolean;
  error: string | null;

  fetchPositions: () => Promise<void>;
  placeOrder: (order: PlaceOrderRequest) => Promise<Position>;
  closePosition: (positionId: string) => Promise<void>;
  updatePosition: (position: Partial<Position> & { id: string }) => void;
  subscribeToPositions: () => void;
}

export const usePositionsStore = create<PositionsState>((set, get) => ({
  positions: [],
  isLoading: false,
  isPlacingOrder: false,
  error: null,

  fetchPositions: async () => {
    set({ isLoading: true, error: null });
    try {
      const positions = await api.getPositions();
      set({ positions, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch positions',
        isLoading: false,
      });
    }
  },

  placeOrder: async (order) => {
    set({ isPlacingOrder: true, error: null });
    try {
      const position = await api.placeOrder(order);
      set((state) => ({
        positions: [...state.positions, position],
        isPlacingOrder: false,
      }));
      return position;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to place order',
        isPlacingOrder: false,
      });
      throw error;
    }
  },

  closePosition: async (positionId) => {
    set({ error: null });
    try {
      await api.closePosition(positionId);
      set((state) => ({
        positions: state.positions.filter((p) => p.id !== positionId),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to close position',
      });
      throw error;
    }
  },

  updatePosition: (update) => {
    set((state) => ({
      positions: state.positions.map((p) =>
        p.id === update.id ? { ...p, ...update } : p
      ),
    }));
  },

  subscribeToPositions: () => {
    wsClient.subscribe('positions');

    wsClient.on('position', (msg: WSMessage) => {
      if (msg.data) {
        const positionUpdate = msg.data as Partial<Position> & { id: string };
        get().updatePosition(positionUpdate);
      }
    });
  },
}));

export function usePositions() {
  return usePositionsStore();
}
