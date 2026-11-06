import type { DetailCode, ErrorCode } from '../constants/error-codes';

// The single error shape every failed request returns (AGENTS.md §6).

/** One field-level problem; `path` is dotted (`features.tableBooking`). */
export interface ErrorDetail {
  path: string;
  code: DetailCode;
  message: string;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
}

export interface ErrorResponseBody {
  error: ErrorBody;
}
