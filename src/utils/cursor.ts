import { createHash } from 'node:crypto';
import type { SearchCriteria } from '../models/search.model';
import { ApplicationError } from './application-error';

const CURSOR_VERSION = 1;

interface CursorPayload {
  v: number;
  /** searchSequenceToken of the last item returned. */
  t: string;
  /** Fingerprint of the criteria the token belongs to. */
  q: string;
}

/** The same value with object keys sorted at every level. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sortKeys(child)]),
    );
  }
  return value;
}

/** Equal criteria give equal text: sorted keys, cuisines as a set. */
function canonical(criteria: SearchCriteria): string {
  return JSON.stringify(
    sortKeys({
      ...criteria,
      cuisines: criteria.cuisines && [...criteria.cuisines].sort(),
    }),
  );
}

/**
 * A token is a position in one sorted result list, so it is only valid for
 * the query that produced it (ADR-003 Rule 8). `limit` is not part of the
 * criteria, so the page size may change between pages.
 */
export function criteriaFingerprint(criteria: SearchCriteria): string {
  return createHash('sha256')
    .update(canonical(criteria))
    .digest('base64url')
    .slice(0, 16);
}

export function encodeCursor(token: string, criteria: SearchCriteria): string {
  const payload: CursorPayload = {
    v: CURSOR_VERSION,
    t: token,
    q: criteriaFingerprint(criteria),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function invalid(message: string): ApplicationError {
  return new ApplicationError('CURSOR_INVALID', message);
}

function parsePayload(cursor: string): CursorPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid('cursor is not valid; start again without cursor');
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('v' in parsed && 't' in parsed && 'q' in parsed) ||
    parsed.v !== CURSOR_VERSION ||
    typeof parsed.t !== 'string' ||
    typeof parsed.q !== 'string'
  ) {
    throw invalid('cursor is not valid; start again without cursor');
  }
  return { v: parsed.v, t: parsed.t, q: parsed.q };
}

/** The token to pass as searchAfter; CURSOR_INVALID when it cannot be used. */
export function decodeCursor(cursor: string, criteria: SearchCriteria): string {
  const payload = parsePayload(cursor);
  if (payload.q !== criteriaFingerprint(criteria)) {
    throw invalid(
      'cursor belongs to a different query (filters or sort changed); start again without cursor',
    );
  }
  return payload.t;
}
