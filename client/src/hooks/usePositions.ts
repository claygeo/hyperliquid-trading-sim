import { create } from 'zustand';
import {
  api,
  isAuthSessionChangedError,
  isUnusableOrderKeyResponseError,
} from '../lib/api';
import type { Position, PlaceOrderRequest } from '../types/trading';

interface PositionsState {
  positions: Position[];
  isLoading: boolean;
  isPlacingOrder: boolean;
  error: string | null;

  fetchPositions: () => Promise<void>;
  placeOrder: (order: PlaceOrderRequest, idempotencyKey?: string) => Promise<Position>;
  closePosition: (positionId: string) => Promise<void>;
  clear: () => void;
}

const MAX_UNCERTAIN_ORDER_ATTEMPTS = 50;

const uncertainOrderAttempts = new Map<string, string>();
const activeOrderAttempts = new Set<symbol>();
let positionsGeneration = 0;

const fingerprintOrder = (order: PlaceOrderRequest) => JSON.stringify([
  order.asset.trim().toUpperCase(),
  order.side,
  order.size,
  order.leverage,
  order.expectedAccountResetCount,
  order.source ?? 'manual',
  order.signalId ?? null,
]);

const rememberUncertainOrder = (fingerprint: string, idempotencyKey: string) => {
  // Refresh insertion order so the bound evicts the least recently failed
  // fingerprint. A newer attempt for the same order supersedes the old key.
  uncertainOrderAttempts.delete(fingerprint);
  uncertainOrderAttempts.set(fingerprint, idempotencyKey);

  while (uncertainOrderAttempts.size > MAX_UNCERTAIN_ORDER_ATTEMPTS) {
    const oldestFingerprint = uncertainOrderAttempts.keys().next().value;
    if (oldestFingerprint === undefined) break;
    uncertainOrderAttempts.delete(oldestFingerprint);
  }
};

export const usePositionsStore = create<PositionsState>((set) => ({
  positions: [],
  isLoading: false,
  isPlacingOrder: false,
  error: null,

  fetchPositions: async () => {
    const generation = positionsGeneration;
    set({ isLoading: true, error: null });
    try {
      const positions = await api.getPositions();
      if (generation !== positionsGeneration) return;
      set({ positions, isLoading: false });
    } catch (error) {
      if (isAuthSessionChangedError(error) || generation !== positionsGeneration) return;
      set({
        positions: [],
        error: error instanceof Error ? error.message : 'Failed to fetch positions',
        isLoading: false,
      });
    }
  },

  placeOrder: async (order, requestedIdempotencyKey) => {
    const generation = positionsGeneration;
    const activeAttempt = Symbol('order-attempt');
    activeOrderAttempts.add(activeAttempt);
    set({ isPlacingOrder: true, error: null });
    const fingerprint = fingerprintOrder(order);
    const idempotencyKey = requestedIdempotencyKey
      ?? uncertainOrderAttempts.get(fingerprint)
      ?? crypto.randomUUID();

    try {
      const position = await api.placeOrder(order, idempotencyKey);
      if (generation !== positionsGeneration) return position;
      if (uncertainOrderAttempts.get(fingerprint) === idempotencyKey) {
        uncertainOrderAttempts.delete(fingerprint);
      }
      set((state) => ({
        positions: state.positions.some((candidate) => candidate.id === position.id)
          ? state.positions
          : [...state.positions, position],
      }));
      return position;
    } catch (error) {
      if (isAuthSessionChangedError(error)) throw error;
      if (generation !== positionsGeneration) throw error;

      if (isUnusableOrderKeyResponseError(error)) {
        if (uncertainOrderAttempts.get(fingerprint) === idempotencyKey) {
          uncertainOrderAttempts.delete(fingerprint);
        }
      } else {
        rememberUncertainOrder(fingerprint, idempotencyKey);
      }
      set({
        error: error instanceof Error ? error.message : 'Failed to place order',
      });
      throw error;
    } finally {
      activeOrderAttempts.delete(activeAttempt);
      set({ isPlacingOrder: activeOrderAttempts.size > 0 });
    }
  },

  closePosition: async (positionId) => {
    const generation = positionsGeneration;
    set({ error: null });
    try {
      await api.closePosition(positionId);
      if (generation !== positionsGeneration) return;
      set((state) => ({
        positions: state.positions.filter((p) => p.id !== positionId),
      }));
    } catch (error) {
      if (isAuthSessionChangedError(error)) throw error;
      if (generation !== positionsGeneration) throw error;
      set({
        error: error instanceof Error ? error.message : 'Failed to close position',
      });
      throw error;
    }
  },

  clear: () => {
    positionsGeneration += 1;
    uncertainOrderAttempts.clear();
    activeOrderAttempts.clear();
    set({
      positions: [],
      isLoading: false,
      isPlacingOrder: false,
      error: null,
    });
  },

}));

export function usePositions() {
  return usePositionsStore();
}
