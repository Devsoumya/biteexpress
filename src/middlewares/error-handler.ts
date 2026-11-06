import type { ErrorRequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { type ErrorCode, RETRY_AFTER_SECONDS } from '../constants/error-codes';
import { ApplicationError } from '../utils/application-error';
import { errorResponse } from '../utils/error-response';
import { toValidationDetails } from '../utils/validation-details';
import { requestContextOf } from './request-id';

/**
 * express.json() rejects a body with an error carrying `type`. Only the types
 * a client can cause are mapped; anything else falls through to a 500.
 */
function bodyParserError(error: unknown): ApplicationError | undefined {
  if (typeof error !== 'object' || error === null || !('type' in error)) {
    return undefined;
  }
  switch (error.type) {
    case 'entity.parse.failed':
      return new ApplicationError(
        'MALFORMED_JSON',
        'Request body is not valid JSON',
      );
    case 'entity.too.large':
      return new ApplicationError(
        'PAYLOAD_TOO_LARGE',
        'Request body is larger than 100 kB',
      );
    case 'charset.unsupported':
    case 'encoding.unsupported':
      return new ApplicationError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Unsupported body charset or encoding',
      );
    default:
      return undefined;
  }
}

/**
 * The request's log line (request-logger) reports the outcome: the catalog
 * code always, and for a 5xx the cause, whose serialized form carries the
 * driver error's class, `code` and, for a validator rejection (121),
 * `errInfo`, which names the failing rule (ADR-004). Nothing is logged here,
 * so each request still has exactly one line.
 */
function recordOutcome(
  response: Response,
  code: ErrorCode,
  status: number,
  cause: unknown,
): void {
  const context = requestContextOf(response);
  if (!context) return;
  context.errorCode = code;
  if (status >= 500) context.error = cause;
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof ZodError) {
    recordOutcome(response, 'VALIDATION_ERROR', 400, error);
    response
      .status(400)
      .json(
        errorResponse(
          'VALIDATION_ERROR',
          'Invalid request',
          toValidationDetails(error),
        ),
      );
    return;
  }

  const known =
    error instanceof ApplicationError ? error : bodyParserError(error);
  if (known) {
    // A 503 is an outage worth investigating even though it is expected;
    // the cause (driver error and code) goes to the log, never the client.
    recordOutcome(response, known.code, known.statusCode, known.cause ?? known);
    if (known.retryable)
      response.set('Retry-After', String(RETRY_AFTER_SECONDS));
    response
      .status(known.statusCode)
      .json(errorResponse(known.code, known.message, known.details));
    return;
  }

  // Input that passed Zod but failed the database validator is a mapping bug
  // on our side, so a 500; the client never sees the driver's message.
  recordOutcome(response, 'INTERNAL_ERROR', 500, error);
  response
    .status(500)
    .json(errorResponse('INTERNAL_ERROR', 'Internal server error'));
};
