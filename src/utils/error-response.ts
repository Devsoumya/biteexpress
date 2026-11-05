import type { ErrorResponseBody } from '../models/error.model';

export function errorResponse(
  code: string,
  message: string,
): ErrorResponseBody {
  return { error: { code, message } };
}
