import type { ErrorCode } from '../constants/error-codes';
import type { ErrorDetail, ErrorResponseBody } from '../models/error.model';

/**
 * The one error body shape (RFC-001 §5): `{ error: { code, message,
 * details? } }`. `details` is omitted, not empty, when there are none.
 */
export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: ErrorDetail[],
): ErrorResponseBody {
  return { error: { code, message, ...(details && { details }) } };
}
