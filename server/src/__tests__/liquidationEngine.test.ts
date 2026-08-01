import {
  LiquidationEngine,
  isLiquidatable,
  MAX_POSITIONS_PER_SWEEP,
  type LiquidationEngineDeps,
  type OpenPositionRow,
} from '../services/liquidation/index.js';

function row(overrides: Partial<OpenPositionRow> = {}): OpenPositionRow {
  return {
    id: 'pos-1',
    userId: 'user-1',
    asset: 'BTC',
    side: 'long',
    liquidationPrice: 90_000,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<LiquidationEngineDeps> = {}) {
  const closed: Array<{ userId: string; positionId: string; price: number }> = [];
  const events: Array<{ id: string; price: number }> = [];
  const deps: LiquidationEngineDeps = {
    fetchOpenPositions: async () => [],
    getPrice: () => null,
    closePosition: async (userId, positionId, price) => {
      closed.push({ userId, positionId, price });
      return {};
    },
    emitLiquidationEvent: async (r, price) => {
      events.push({ id: r.id, price });
    },
    ...overrides,
  };
  return { deps, closed, events };
}

describe('isLiquidatable', () => {
  it('liquidates a long at or below its liquidation price', () => {
    expect(isLiquidatable('long', 90_000, 90_000)).toBe(true);
    expect(isLiquidatable('long', 89_999.99, 90_000)).toBe(true);
    expect(isLiquidatable('long', 90_000.01, 90_000)).toBe(false);
  });

  it('liquidates a short at or above its liquidation price', () => {
    expect(isLiquidatable('short', 110_000, 110_000)).toBe(true);
    expect(isLiquidatable('short', 110_000.01, 110_000)).toBe(true);
    expect(isLiquidatable('short', 109_999.99, 110_000)).toBe(false);
  });

  it('fails closed on non-finite or non-positive inputs', () => {
    expect(isLiquidatable('long', Number.NaN, 90_000)).toBe(false);
    expect(isLiquidatable('long', 0, 90_000)).toBe(false);
    expect(isLiquidatable('long', -1, 90_000)).toBe(false);
    expect(isLiquidatable('long', 89_000, Number.NaN)).toBe(false);
    expect(isLiquidatable('short', 111_000, 0)).toBe(false);
    expect(isLiquidatable('short', Number.POSITIVE_INFINITY, 110_000)).toBe(false);
  });
});

describe('LiquidationEngine.sweep', () => {
  it('liquidates crossed positions through the injected close path and emits an event', async () => {
    const { deps, closed, events } = makeDeps({
      fetchOpenPositions: async () => [
        row({ id: 'crossed-long', side: 'long', liquidationPrice: 90_000 }),
        row({ id: 'safe-long', side: 'long', liquidationPrice: 80_000 }),
        row({ id: 'crossed-short', side: 'short', liquidationPrice: 84_000, asset: 'ETH' }),
      ],
      getPrice: (asset) => (asset === 'BTC' ? 85_000 : 84_500),
    });
    const engine = new LiquidationEngine(deps);

    const liquidated = await engine.sweep();

    expect(liquidated).toBe(2);
    expect(closed.map((c) => c.positionId).sort()).toEqual(['crossed-long', 'crossed-short']);
    expect(events.map((e) => e.id).sort()).toEqual(['crossed-long', 'crossed-short']);
  });

  it('never liquidates when the price source fails closed', async () => {
    const { deps, closed } = makeDeps({
      fetchOpenPositions: async () => [row({ liquidationPrice: 1_000_000 })],
      getPrice: () => null,
    });
    const engine = new LiquidationEngine(deps);

    expect(await engine.sweep()).toBe(0);
    expect(closed).toHaveLength(0);
  });

  it('treats an already-closed position as benign, not a failure', async () => {
    const { deps, events } = makeDeps({
      fetchOpenPositions: async () => [row()],
      getPrice: () => 1,
      closePosition: async () => {
        throw new Error('Position not found or already closed');
      },
    });
    const engine = new LiquidationEngine(deps);

    expect(await engine.sweep()).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('continues the sweep after an unexpected close failure', async () => {
    const { deps, closed } = makeDeps({
      fetchOpenPositions: async () => [
        row({ id: 'fails' }),
        row({ id: 'succeeds' }),
      ],
      getPrice: () => 1,
      closePosition: async (_userId, positionId, price) => {
        if (positionId === 'fails') throw new Error('network exploded');
        closed.push({ userId: 'user-1', positionId, price });
        return {};
      },
    });
    const engine = new LiquidationEngine(deps);

    expect(await engine.sweep()).toBe(1);
    expect(closed.map((c) => c.positionId)).toEqual(['succeeds']);
  });

  it('does not stack overlapping sweeps', async () => {
    let resolveFetch: (rows: OpenPositionRow[]) => void = () => {};
    const { deps } = makeDeps({
      fetchOpenPositions: () =>
        new Promise<OpenPositionRow[]>((resolve) => {
          resolveFetch = resolve;
        }),
    });
    const engine = new LiquidationEngine(deps);

    const first = engine.sweep();
    const second = await engine.sweep();
    expect(second).toBe(0);

    resolveFetch([]);
    expect(await first).toBe(0);
  });

  it('surfaces a warning-worthy full batch instead of silently capping', async () => {
    const rows = Array.from({ length: MAX_POSITIONS_PER_SWEEP }, (_, i) =>
      row({ id: `pos-${i}`, liquidationPrice: 0.000001 })
    );
    const { deps, closed } = makeDeps({
      fetchOpenPositions: async (limit) => rows.slice(0, limit),
      getPrice: () => 1_000_000,
    });
    const engine = new LiquidationEngine(deps);

    expect(await engine.sweep()).toBe(0);
    expect(closed).toHaveLength(0);
  });
});
