import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApplicationError } from '../shared/errors/application-error';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof ApplicationError) {
    response
      .status(error.statusCode)
      .json({ error: { code: error.code, message: error.message } });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request' },
    });
    return;
  }

  console.error(error);
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
};
