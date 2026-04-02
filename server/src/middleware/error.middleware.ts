import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function errorMiddleware(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  logger.error(`${req.method} ${req.path}: ${error.message}`);

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: error.message,
    });
  }

  // Log unexpected errors
  if (process.env.NODE_ENV === 'development') {
    console.error(error.stack);
  }

  res.status(500).json({
    error: 'Internal server error',
  });
}
