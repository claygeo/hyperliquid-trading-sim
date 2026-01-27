import { Request, Response, NextFunction } from 'express';
import { RateLimitError } from '../lib/errors.js';

interface RateLimitStore {
  count: number;
  resetTime: number;
}

const store = new Map<string, RateLimitStore>();

const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 100; // requests per window

function getClientKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' 
    ? forwarded.split(',')[0] 
    : req.ip || req.socket.remoteAddress || 'unknown';
  return ip;
}

export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const key = getClientKey(req);
  const now = Date.now();
  
  let entry = store.get(key);
  
  if (!entry || now > entry.resetTime) {
    entry = {
      count: 1,
      resetTime: now + WINDOW_MS,
    };
    store.set(key, entry);
  } else {
    entry.count++;
  }

  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - entry.count));
  res.setHeader('X-RateLimit-Reset', entry.resetTime);

  if (entry.count > MAX_REQUESTS) {
    const error = new RateLimitError();
    res.status(429).json({
      error: error.message,
      retryAfter: Math.ceil((entry.resetTime - now) / 1000),
    });
    return;
  }

  next();
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now > entry.resetTime) {
      store.delete(key);
    }
  }
}, WINDOW_MS);
