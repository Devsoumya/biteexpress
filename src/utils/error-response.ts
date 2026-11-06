import type { ErrorCode } from '../constants/error-codes';
import type { ErrorDetail, ErrorResponseBody } from '../models/error.model';

export function errorResponse(
  code: ErrorCode,
  message: string,
  details?: ErrorDetail[],
): ErrorResponseBody {
  return { error: { code, message, ...(details && { details }) } };
}
