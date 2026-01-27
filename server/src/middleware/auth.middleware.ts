import { Request, Response, NextFunction } from 'express';
import { getSupabase } from '../lib/supabase.js';
import { AuthenticationError } from '../lib/errors.js';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  user?: {
    id: string;
    email: string;
  };
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('Missing authorization token');
    }

    const token = authHeader.split(' ')[1];
    const supabase = getSupabase();

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new AuthenticationError('Invalid or expired token');
    }

    req.userId = user.id;
    req.user = {
      id: user.id,
      email: user.email!,
    };

    next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      res.status(401).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Authentication failed' });
    }
  }
}

export function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  authMiddleware(req, res, next);
}
