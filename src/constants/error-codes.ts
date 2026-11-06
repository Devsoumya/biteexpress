/** Seconds a client should wait before retrying a 503 (the readiness cache window). */
export const RETRY_AFTER_SECONDS = 5;

interface ErrorCodeSpec {
  status: number;
  /** Sent as Retry-After: the failure is transient and worth retrying. */
  retryable?: true;
}

/**
 * Every error code the API returns, with its HTTP status (RFC-001 §5). The
 * single source: ApplicationError takes a code and gets its status from here,
 * so a code and a status can never disagree. A new failure mode gets its own
 * entry rather than reusing a code that means something else.
 */
export const ERROR_CATALOG = {
  VALIDATION_ERROR: { status: 400 },
  MALFORMED_JSON: { status: 400 },
  INVALID_ID: { status: 400 },
  CURSOR_INVALID: { status: 400 },
  RESTAURANT_NOT_FOUND: { status: 404 },
  ROUTE_NOT_FOUND: { status: 404 },
  METHOD_NOT_ALLOWED: { status: 405 },
  PAYLOAD_TOO_LARGE: { status: 413 },
  UNSUPPORTED_MEDIA_TYPE: { status: 415 },
  INTERNAL_ERROR: { status: 500 },
  DATABASE_UNAVAILABLE: { status: 503, retryable: true },
  DATABASE_TIMEOUT: { status: 503, retryable: true },
  SEARCH_UNAVAILABLE: { status: 503, retryable: true },
  SEARCH_TIMEOUT: { status: 503, retryable: true },
} as const satisfies Record<string, ErrorCodeSpec>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

/**
 * Stable, machine-readable reason for one field in VALIDATION_ERROR details.
 * Messages are for people and may change; these do not.
 */
export const DETAIL_CODES = [
  'required',
  'invalid_type',
  'too_small',
  'too_large',
  'invalid_format',
  'invalid_value',
  'unknown_field',
  'custom',
] as const;

export type DetailCode = (typeof DETAIL_CODES)[number];
