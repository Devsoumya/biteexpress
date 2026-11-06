import {
  MongoNetworkError,
  MongoNetworkTimeoutError,
  MongoOperationTimeoutError,
  MongoServerError,
  MongoServerSelectionError,
  MongoTopologyClosedError,
} from 'mongodb';
import type { ErrorCode } from '../constants/error-codes';

export type MongoFailureKind = 'timeout' | 'unavailable' | 'other';

// Server error codes that mean "the server cannot serve you right now", not
// "your command is wrong". Named in the MongoDB error code list.
const TIMEOUT_CODES = new Set([
  50, // MaxTimeMSExpired
  89, // NetworkTimeout
  262, // ExceededTimeLimit
]);
const UNAVAILABLE_CODES = new Set([
  6, // HostUnreachable
  7, // HostNotFound
  91, // ShutdownInProgress
  189, // PrimarySteppedDown
  10107, // NotWritablePrimary
  11600, // InterruptedAtShutdown
  11602, // InterruptedDueToReplStateChange
  13435, // NotPrimaryNoSecondaryOk
  13436, // NotPrimaryOrSecondary
]);

/**
 * Classifies a driver error by class and code, never by message. Used only by
 * repositories (the one layer that knows the driver). Everything else is
 * "other": a bug or a bad command, which must surface as a 500, not be
 * disguised as an outage.
 */
export function classifyMongoError(error: unknown): MongoFailureKind {
  // MongoNetworkTimeoutError extends MongoNetworkError, so it is checked first.
  if (
    error instanceof MongoOperationTimeoutError ||
    error instanceof MongoNetworkTimeoutError
  ) {
    return 'timeout';
  }
  // Topology closed: the client was closed (shutdown racing a request), or
  // the driver gave up after a failed first connection.
  if (
    error instanceof MongoNetworkError ||
    error instanceof MongoServerSelectionError ||
    error instanceof MongoTopologyClosedError
  ) {
    return 'unavailable';
  }
  if (error instanceof MongoServerError && typeof error.code === 'number') {
    if (TIMEOUT_CODES.has(error.code)) return 'timeout';
    if (UNAVAILABLE_CODES.has(error.code)) return 'unavailable';
  }
  return 'other';
}

/** The catalog codes for an outage or a timeout: a retryable 503. */
export type OutageCode = Extract<
  ErrorCode,
  | 'DATABASE_TIMEOUT'
  | 'DATABASE_UNAVAILABLE'
  | 'SEARCH_TIMEOUT'
  | 'SEARCH_UNAVAILABLE'
>;

/** The catalog code for a failure, per engine; undefined means "other". */
export function failureCode(
  error: unknown,
  engine: 'database' | 'search',
): OutageCode | undefined {
  const kind = classifyMongoError(error);
  if (kind === 'other') return undefined;
  if (engine === 'search') {
    return kind === 'timeout' ? 'SEARCH_TIMEOUT' : 'SEARCH_UNAVAILABLE';
  }
  return kind === 'timeout' ? 'DATABASE_TIMEOUT' : 'DATABASE_UNAVAILABLE';
}
