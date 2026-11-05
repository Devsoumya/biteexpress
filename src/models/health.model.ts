export type ProbedIndexState = 'ok' | 'missing' | 'not_queryable';
export type SearchIndexState = ProbedIndexState | 'error' | 'skipped';

export interface ReadinessChecks {
  mongo: 'ok' | 'fail';
  searchIndex: SearchIndexState;
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessChecks;
}

/** MongoDB checks behind /ready. Implemented by MongoHealthRepository. */
export interface HealthRepository {
  ping(): Promise<void>;
  searchIndexState(): Promise<ProbedIndexState>;
}

/** Decides readiness from the repository's checks. */
export interface ReadinessService {
  check(): Promise<ReadinessResult>;
}

export interface ReadinessServiceOptions {
  /** How long a result (pass or fail) is reused. Default 5000 ms. */
  ttlMs?: number;
  /** Clock, injectable so tests need no timers. Default Date.now. */
  now?: () => number;
}

export interface HealthResponseBody {
  status: 'ok';
}

export interface ReadinessResponseBody {
  status: 'ready' | 'not_ready';
  checks: ReadinessChecks;
}
