import { Request, Response, NextFunction } from 'express';
import { authMiddleware, optionalAuthMiddleware, AuthenticatedRequest } from '../middleware/auth.middleware';
import { rateLimitMiddleware } from '../middleware/rateLimit.middleware';

// Mock supabase
const mockGetUser = jest.fn();
jest.mock('../lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

jest.mock('../lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

function mockReq(overrides: Partial<Request> = {}): AuthenticatedRequest {
  return {
    headers: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as AuthenticatedRequest;
}

function mockRes(): Response {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res as Response;
}

describe('authMiddleware', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects requests without authorization header', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing authorization token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects requests with non-Bearer token', async () => {
    const req = mockReq({ headers: { authorization: 'Basic abc123' } });
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid tokens', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } });

    const req = mockReq({ headers: { authorization: 'Bearer invalid-token' } });
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(next).not.toHaveBeenCalled();
  });

  it('sets userId and user on valid token', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@test.com' } },
      error: null,
    });

    const req = mockReq({ headers: { authorization: 'Bearer valid-token' } });
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(req.userId).toBe('user-123');
    expect(req.user).toEqual({ id: 'user-123', email: 'test@test.com' });
    expect(next).toHaveBeenCalled();
  });
});

describe('optionalAuthMiddleware', () => {
  it('passes through without auth header', () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    optionalAuthMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.userId).toBeUndefined();
  });

  it('delegates to authMiddleware when Bearer token present', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-456', email: 'a@b.com' } },
      error: null,
    });

    const req = mockReq({ headers: { authorization: 'Bearer some-token' } });
    const res = mockRes();
    const next = jest.fn();

    await optionalAuthMiddleware(req, res, next);

    // Should have delegated to authMiddleware which calls next
    expect(next).toHaveBeenCalled();
  });
});

describe('rateLimitMiddleware', () => {
  it('allows requests under the limit', () => {
    const req = mockReq({ ip: '10.0.0.1' });
    const res = mockRes();
    const next = jest.fn();

    rateLimitMiddleware(req as Request, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
  });

  it('sets rate limit headers', () => {
    const req = mockReq({ ip: '10.0.0.2' });
    const res = mockRes();
    const next = jest.fn();

    rateLimitMiddleware(req as Request, res, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 100);
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
  });

  it('blocks requests over the limit', () => {
    const ip = '10.0.0.99';

    // Exhaust the limit
    for (let i = 0; i < 101; i++) {
      const req = mockReq({ ip });
      const res = mockRes();
      const next = jest.fn();
      rateLimitMiddleware(req as Request, res, next);

      if (i < 100) {
        expect(next).toHaveBeenCalled();
      } else {
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
          error: 'Too many requests',
        }));
        expect(next).not.toHaveBeenCalled();
      }
    }
  });
});
