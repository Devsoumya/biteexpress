import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { ApplicationError } from '../utils/application-error';
import { errorResponse } from '../utils/error-response';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof ApplicationError) {
    response
      .status(error.statusCode)
      .json(errorResponse(error.code, error.message));
    return;
  }

  if (error instanceof ZodError) {
    response
      .status(400)
      .json(errorResponse('VALIDATION_ERROR', 'Invalid request'));
    return;
  }

  console.error(error);
  response
    .status(500)
    .json(errorResponse('INTERNAL_ERROR', 'Internal server error'));
};
