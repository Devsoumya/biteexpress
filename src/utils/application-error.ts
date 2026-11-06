import { ERROR_CATALOG, type ErrorCode } from '../constants/error-codes';
import type { ErrorDetail } from '../models/error.model';

/**
 * An error with a catalog code; its HTTP status comes from the catalog. For
 * 5xx codes, `cause` keeps the underlying error for the logs; the client only
 * ever sees `code` and `message`.
 */
export class ApplicationError extends Error {
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly details: ErrorDetail[] | undefined;

  constructor(
    readonly code: ErrorCode,
    message: string,
    options: { details?: ErrorDetail[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApplicationError';
    const spec: { status: number; retryable?: true } = ERROR_CATALOG[code];
    this.statusCode = spec.status;
    this.retryable = spec.retryable === true;
    this.details = options.details;
  }
}
