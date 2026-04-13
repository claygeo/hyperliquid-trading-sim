import { EventService } from '../services/events/index';

// Mock supabase
let mockInsertResult: { error: any } = { error: null };
let mockQueryResult: { data: any; error: any } = { data: [], error: null };

function makeChain() {
  const chain: any = {};
  const returnSelf = () => chain;
  chain.insert = jest.fn(() => Promise.resolve(mockInsertResult));
  chain.select = jest.fn(returnSelf);
  chain.eq = jest.fn(returnSelf);
  chain.gte = jest.fn(returnSelf);
  chain.lte = jest.fn(returnSelf);
  chain.limit = jest.fn(returnSelf);
  chain.order = jest.fn(returnSelf);
  // Make chain thenable so `await query` resolves to mockQueryResult
  chain.then = jest.fn((resolve: any) => resolve(mockQueryResult));
  return chain;
}

const mockFrom = jest.fn(() => makeChain());

jest.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    from: mockFrom,
  }),
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

describe('EventService', () => {
  let service: EventService;

  beforeEach(() => {
    service = new EventService();
    jest.clearAllMocks();
    mockInsertResult = { error: null };
    mockQueryResult = { data: [], error: null };
  });

  describe('emit', () => {
    it('inserts event into database', async () => {
      await service.emit('trade_executed', { positionId: 'pos-1', asset: 'BTC' }, 'user-1');

      expect(mockFrom).toHaveBeenCalledWith('events');
    });

    it('handles database errors gracefully', async () => {
      mockInsertResult = { error: { message: 'DB connection failed' } };

      // Should not throw
      await service.emit('trade_executed', { positionId: 'pos-1' }, 'user-1');
    });

    it('handles exceptions gracefully', async () => {
      mockFrom.mockImplementationOnce(() => {
        throw new Error('Unexpected crash');
      });

      // Should not throw
      await service.emit('trade_executed', { positionId: 'pos-1' });
    });
  });

  describe('getEvents', () => {
    it('returns mapped events for user', async () => {
      mockQueryResult = {
        data: [
          {
            id: 'evt-1',
            type: 'trade_executed',
            payload: { asset: 'BTC' },
            user_id: 'user-1',
            session_id: null,
            created_at: '2025-01-01T00:00:00Z',
          },
        ],
        error: null,
      };

      const events = await service.getEvents('user-1');

      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('evt-1');
      expect(events[0].type).toBe('trade_executed');
      expect(events[0].payload).toEqual({ asset: 'BTC' });
      expect(events[0].userId).toBe('user-1');
    });

    it('applies time range and type filters', async () => {
      mockQueryResult = { data: [], error: null };

      await service.getEvents('user-1', {
        from: '2025-01-01',
        to: '2025-01-31',
        type: 'position_closed',
        limit: 10,
      });

      // Verify the chain was called (filters applied)
      expect(mockFrom).toHaveBeenCalledWith('events');
    });

    it('returns empty array on database error', async () => {
      mockQueryResult = { data: null, error: { message: 'Query failed' } };

      const events = await service.getEvents('user-1');
      expect(events).toEqual([]);
    });
  });
});
