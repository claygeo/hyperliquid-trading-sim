import { PositionManager } from '../services/trading/positionManager';

// Mock supabase - use a flexible chain that resolves on terminal methods
const mockRpc = jest.fn();
let mockQueryResult: { data: any; error: any } = { data: null, error: null };

function makeQueryChain() {
  const chain: any = {};
  const returnSelf = () => chain;
  chain.select = jest.fn(returnSelf);
  chain.eq = jest.fn(returnSelf);
  chain.order = jest.fn(() => Promise.resolve(mockQueryResult));
  chain.single = jest.fn(() => Promise.resolve(mockQueryResult));
  chain.update = jest.fn(returnSelf);
  return chain;
}

jest.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: jest.fn(() => makeQueryChain()),
    rpc: mockRpc,
  }),
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const mockDbPosition = {
  id: 'pos-1',
  user_id: 'user-1',
  asset: 'BTC',
  side: 'long',
  entry_price: 50000,
  current_price: 51000,
  size: 1,
  leverage: 10,
  margin: 5000,
  liquidation_price: 45250,
  unrealized_pnl: 1000,
  unrealized_pnl_percent: 20,
  realized_pnl: 0,
  status: 'open',
  source: 'manual',
  signal_id: null,
  opened_at: '2025-01-01T00:00:00Z',
};

describe('PositionManager', () => {
  let manager: PositionManager;

  beforeEach(() => {
    manager = new PositionManager();
    jest.clearAllMocks();
  });

  describe('getOpenPositions', () => {
    it('returns mapped positions for user', async () => {
      mockQueryResult = { data: [mockDbPosition], error: null };

      const positions = await manager.getOpenPositions('user-1');

      expect(positions).toHaveLength(1);
      expect(positions[0].id).toBe('pos-1');
      expect(positions[0].asset).toBe('BTC');
      expect(positions[0].source).toBe('manual');
    });

    it('returns empty array when no positions', async () => {
      mockQueryResult = { data: [], error: null };

      const positions = await manager.getOpenPositions('user-1');
      expect(positions).toEqual([]);
    });

    it('throws on database error', async () => {
      mockQueryResult = { data: null, error: { message: 'DB error' } };

      await expect(manager.getOpenPositions('user-1')).rejects.toThrow('Failed to fetch positions');
    });
  });

  describe('getPosition', () => {
    it('returns position when found', async () => {
      mockQueryResult = { data: mockDbPosition, error: null };

      const position = await manager.getPosition('user-1', 'pos-1');

      expect(position).not.toBeNull();
      expect(position!.id).toBe('pos-1');
    });

    it('returns null when not found', async () => {
      mockQueryResult = { data: null, error: { message: 'Not found' } };

      const position = await manager.getPosition('user-1', 'nonexistent');
      expect(position).toBeNull();
    });
  });

  describe('checkLiquidations', () => {
    it('liquidates positions below liquidation price', async () => {
      const longPosition = {
        ...mockDbPosition,
        liquidation_price: 45250,
        entry_price: 50000,
        side: 'long',
      };

      mockQueryResult = { data: [longPosition], error: null };
      mockRpc.mockResolvedValue({ error: null });

      const prices = new Map([['BTC', 44000]]);
      const liquidated = await manager.checkLiquidations('user-1', prices);

      expect(liquidated).toHaveLength(1);
      expect(mockRpc).toHaveBeenCalledWith('liquidate_position_atomic', { p_position_id: 'pos-1' });
    });

    it('does not liquidate positions above liquidation price', async () => {
      mockQueryResult = { data: [mockDbPosition], error: null };

      const prices = new Map([['BTC', 52000]]);
      const liquidated = await manager.checkLiquidations('user-1', prices);

      expect(liquidated).toHaveLength(0);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('skips assets without prices', async () => {
      mockQueryResult = { data: [mockDbPosition], error: null };

      const prices = new Map<string, number>();
      const liquidated = await manager.checkLiquidations('user-1', prices);

      expect(liquidated).toHaveLength(0);
    });
  });
});
